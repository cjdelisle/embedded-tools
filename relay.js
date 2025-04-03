const { SerialPort } = require('serialport');
const { sleep_ms } = require('./util.js');

const USB_RELAY = Object.freeze([
    // [off, on] - For status, these are status and status-return
    [Buffer.from(':FE0100200000FF\r\n', 'ascii'), Buffer.from(':FE0100000010F1\r\n', 'ascii')], // status & status return
    [Buffer.from(':FE0500000000FD\r\n', 'ascii'), Buffer.from(':FE050000FF00FE\r\n', 'ascii')], // channel-1
    [Buffer.from(':FE0500010000FC\r\n', 'ascii'), Buffer.from(':FE050001FF00FD\r\n', 'ascii')], // channel-2
    [Buffer.from(':FE0500020000FB\r\n', 'ascii'), Buffer.from(':FE050002FF00FC\r\n', 'ascii')], // channel-3
    [Buffer.from(':FE0500030000FA\r\n', 'ascii'), Buffer.from(':FE050003FF00FB\r\n', 'ascii')], // channel-4
    [Buffer.from(':FE0500040000F9\r\n', 'ascii'), Buffer.from(':FE050004FF00FA\r\n', 'ascii')], // channel-5
    [Buffer.from(':FE0500050000F8\r\n', 'ascii'), Buffer.from(':FE050005FF00F9\r\n', 'ascii')], // channel-6
    [Buffer.from(':FE0500060000F7\r\n', 'ascii'), Buffer.from(':FE050006FF00F8\r\n', 'ascii')], // channel-7
    [Buffer.from(':FE0500070000F6\r\n', 'ascii'), Buffer.from(':FE050007FF00F7\r\n', 'ascii')], // channel-8
    [Buffer.from(':FE0500080000F5\r\n', 'ascii'), Buffer.from(':FE050008FF00F6\r\n', 'ascii')], // channel-9
    [Buffer.from(':FE0500090000F4\r\n', 'ascii'), Buffer.from(':FE050009FF00F5\r\n', 'ascii')], // channel-10
    [Buffer.from(':FE05000A0000F3\r\n', 'ascii'), Buffer.from(':FE05000AFF00F4\r\n', 'ascii')], // channel-11
    [Buffer.from(':FE05000B0000F2\r\n', 'ascii'), Buffer.from(':FE05000BFF00F3\r\n', 'ascii')], // channel-12
    [Buffer.from(':FE05000C0000F1\r\n', 'ascii'), Buffer.from(':FE05000CFF00F2\r\n', 'ascii')], // channel-13
    [Buffer.from(':FE05000D0000F0\r\n', 'ascii'), Buffer.from(':FE05000DFF00F1\r\n', 'ascii')], // channel-14
    [Buffer.from(':FE05000E0000FF\r\n', 'ascii'), Buffer.from(':FE05000EFF00F0\r\n', 'ascii')], // channel-15
    [Buffer.from(':FE05000F0000FE\r\n', 'ascii'), Buffer.from(':FE05000FFF00FF\r\n', 'ascii')], // channel-16
    [Buffer.from(':FE0F00000010020000E1\r\n', 'ascii'), Buffer.from(':FE0F0000001002FFFFE3\r\n', 'ascii')] // all channels
]);

const RESET_SLEEP_MS = 1000;

// Function to write to serial port with a delay
function writeToPort(port, data) {
    return new Promise((resolve, reject) => {
        port.write(data, (err) => {
            if (err) {
                reject(err);
            } else {
                port.drain(() => setTimeout(resolve, 100)); // Wait 100ms after write
            }
        });
    });
}

// Function to perform the requested task
async function performTask(port, task) {
    console.log(`Performing task: ${task}`);

    if (task === 'status') {
        await writeToPort(port, USB_RELAY[0][0]); // Send status command
        port.once('data', (data) => {
            console.log('Status response:', data.toString('hex'));
        });
        return 0;
    }

    let index = -1;
    let state = -1;

    if (task === 'all-on') {
        index = 17;
        state = 1;
    } else if (task === 'all-off') {
        index = 17;
        state = 0;
    } else if (task.startsWith('channel-')) {
        const parts = task.split('-');
        const channelNum = parseInt(parts[1], 10);
        if (channelNum >= 1 && channelNum <= 16) {
            index = channelNum; // Channels are 1-based in task name, but 0-based in array after status
            if (parts[2] === 'reset') {
                await performTask(port, `channel-${channelNum}-on`);
                await sleep_ms(RESET_SLEEP_MS);
                await performTask(port, `channel-${channelNum}-off`);
                return 0;
            }
            state = parts[2] === 'on' ? 1 : 0;
        }
    }

    if (index === -1 || state === -1) {
        console.error('Invalid task:', task);
        return 100;
    }

    await writeToPort(port, USB_RELAY[index][state]);
    return 0;
}

const doRelayTask = module.exports.doRelayTask = (serialPortPath, task) => new Promise(resolve => {
    let ret = 0;

    const done = () => {
        resolve(ret);
        resolve = ()=>{};
    };

    const port = new SerialPort({
        path: serialPortPath,
        baudRate: 9600
    }, (err) => {
        if (err) {
            console.error('Error opening serial port:', err.message);
            ret = 2;
            done();
        }
    });

    // Handle port open and execute
    port.on('open', async () => {
        console.log('Serial port opened.');
        ret = await performTask(port, task);
        port.close();
    });
    
    port.on('error', (err) => {
        console.error('Serial port error:', err.message);
        if (!ret) { ret = 1; }
        done();
    });

    port.on('close', done);
});

const main = async () => {
    // Get command-line arguments
    const args = process.argv.slice(2);
    const serialPortPath = args[0]; // First argument: serial port (e.g., /dev/ttyUSB0 or COM3)
    const task = args[1]; // Second argument: task to perform

    if (!serialPortPath || !task) {
        console.error('Usage: node serial_relay.js <serial_port> <task>');
        console.error('Tasks:');
        console.error('     status   Read the status from the relay block');
        console.error('     channel-<n>-on      Power relay number <n>');
        console.error('     channel-<n>-off     Power off relay <n>');
        console.error('     channel-<n>-reset   Power relay number <n> on and then off');
        console.error('     all-on, all-off     Switch all relays');
        process.exit(1);
    }

    const ret = await doRelayTask(serialPortPath, task);
    process.exit(ret);
}

if (!module.parent) {
    main();
}