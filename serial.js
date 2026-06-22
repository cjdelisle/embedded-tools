const { SerialPort } = require('serialport');
const XModem = require('xmodem.js');

const { sleep_ms } = require('./util.js');

/**
 * @typedef {() => string | void} callback
 * @typedef {() => Promise<string | void>} pcallback
 * @typedef {[RegExp | null, string | callback | pcallback]} arrayElem
 */

const LINE_QUIET_MS = 50;

/**
 * Executes a sequence of actions on a serial port.
 * @param {string} portPath - The serial port path (e.g., '/dev/ttyUSB3')
 * @param {arrayElem[]} sequence - Array of [regex|null, action] pairs
 */
module.exports.Serial = (portPath, func) => {
    const port = new SerialPort({
        path: portPath,
        baudRate: 115200,
    }, (err) => {
        if (err) {
            console.error('Error opening port:', err.message);
            return;
        }
        console.log(`Connected to ${portPath}`);
    });

    let textHandler = async (text)=>false;
    let done = false;

    const waitText = (handler) => new Promise((resolve) => {
        if (done) { return void resolve(); }
        textHandler = async (text) => {
            if (done || await handler(text)) {
                textHandler = async ()=>{};
                const r = resolve;
                resolve = () => {};
                r();
            }
        };
    });

    async function sendText(data) {
        if (done) { return; }
        console.log('< ' + data);
        for (let char of (data + '\r')) {
            await new Promise((resolve) => {
                    port.write(char, (err) => {
                        if (err) console.error('Write error:', err.message);
                        resolve();
                    });
            });
            await sleep_ms(10);
        }
    }

    async function recvLine(line) {
        console.log('> ' + line.replace(/[\r\n]/g, ''));
        textHandler(line);
    }

    let remaining = '';
    const onLineQuiet = () => {
        if (done) {
            if (port.isOpen) {
                port.close();
            }
            return;
        }
        const r = remaining;
        remaining = '';
        if (r !== '') {
            recvLine(r);
        }
    }

    let noOutputHandler = null;
    let noOutputMs = LINE_QUIET_MS;

    const onNoOutput = (handler, ms) => {
        if (ms < LINE_QUIET_MS) {
            throw new Error("No output timeout must be at least " + LINE_QUIET_MS + "ms");
        }
        noOutputHandler = handler;
        noOutputMs = ms;
    };

    let lineQuietTimeout = null;
    const resetLineQuietTimer = () => {
        if (lineQuietTimeout) {
            clearTimeout(lineQuietTimeout);
        }
        lineQuietTimeout = setTimeout(() => {
            if (noOutputHandler) {
                lineQuietTimeout = setTimeout(() => {
                    const h = noOutputHandler;
                    noOutputHandler = null;
                    if (h) { h(); }
                }, noOutputMs - LINE_QUIET_MS);
            } else {
                lineQuietTimeout = null;
            }
            onLineQuiet();
        }, LINE_QUIET_MS);
    };

    const abort = () => {
        done = true;
        noOutputHandler = null;
        resetLineQuietTimer();
    };

    const onData = async (data) => {
        data = remaining + data.toString();
        const lines = data.split('\r');
        remaining = lines.pop();
        for (const line of lines) {
            recvLine(line.trim());
        }
        resetLineQuietTimer();
    };

    async function sendXmdm(data) {
        const noh = noOutputHandler;
        noOutputHandler = null;
        port.removeListener('data', onData);

        return new Promise((resolve) => {

            const done = (err) => {
                noOutputHandler = noh;
                resetLineQuietTimer();
                if (!resolve) {
                    return;
                }
                const r = resolve;
                resolve = null;
                r(err);
            };

            let errorTimeout;
            const updateErrorTimeout = () => {
                if (errorTimeout) { clearTimeout(errorTimeout); }
                errorTimeout = setTimeout(() => {
                    console.log('Timeout waiting for xmodem reply');
                    done(new Error('Timeout waiting for xmodem reply'));
                }, 20000);
            }

            let timeOfLastMsg = 0;

            XModem.on('status', (st) => {
                updateErrorTimeout();
                if ((+new Date() - timeOfLastMsg) < 3000) {
                    return;
                }
                if (st.action === 'send') {
                    const doneK = Math.floor(st.block * 128 / 1024);
                    const totalK = Math.floor(data.length / 1024);
                    const pct = Math.floor(doneK / totalK * 100);
                    console.log(`SEND ${doneK}K / ${totalK}K (${pct}%)`);
                    timeOfLastMsg = +new Date();
                    return;
                } else if (st.action === 'recv' && st.signal === 'ACK') {
                    return;
                }
                console.log('Unknown event:', st);
            });
            XModem.on('stop', (st) => {
                console.log('xmdm done', st);
                if (errorTimeout) { clearTimeout(errorTimeout); }
                port.on('data', onData);
                done(null);
            });
            XModem.send(port, data);
        });
    }

    port.on('data', onData);

    // Close the port when done (optional, depending on your use case)
    port.on('end', () => console.log('Port closed'));

    port.on('open', () => {
        console.log('port open');
        setTimeout(() => {
            (async () => {
                console.log("start");
                await func(Object.freeze({sendText, waitText, onNoOutput, abort, sendXmdm}));
                done = true;
                resetLineQuietTimer();
            })();
        }, 100);
    });

    return new Promise((resolve) => {
        port.on('close', () => resolve());
    });
}
