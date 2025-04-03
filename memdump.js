// SPDX-License-Identifier: GPL-2.0-only
const Fs = require('fs');
const { Serial } = require('./serial.js');
const { doRelayTask } = require('./relay.js');

const DUMP_LINE = /^([0-9a-f]{8})\s{2}([0-9a-f]{2}\s){3}[0-9a-f]{2}(\.[0-9a-f]{2}\s[0-9a-f]{2}\s[0-9a-f]{2}\s[0-9a-f]{2}){3}\s{2}\|.{16}\|$/;

const DUMP_PAYLOAD = /^[0-9a-f]{8}\s\s([0-9a-f \.]{47})\s\s\|.{16}\|$/;

const MARKER = '-----DUMP-LINE----- ';


async function run(tty, relayTTy, relayChannel, start, end) {
    let continueFrom = start;
    let remainingLength = end - continueFrom;
    for (;;) {
        let crashed = false;
        doRelayTask(relayTTy, `channel-${relayChannel}-reset`);
        await Serial(tty, async (serial) => {
            serial.onNoOutput(() => {
                console.log('No output for 3 seconds');
                crashed = true;
                serial.abort();
            }, 3000);
            await serial.waitText((text) => /enter boot command mode/.test(text));
            serial.sendText('');
            // TODO handle username/password
            await serial.waitText((text) => /bldr/.test(text));
            serial.sendText(`dump ${continueFrom.toString(16)} ${remainingLength.toString(16)}`);
            await serial.waitText((text) => {
                if (DUMP_LINE.test(text)) {
                    const location = text.replace(DUMP_LINE, (_all, a) => a);
                    continueFrom = Number('0x' + location) + 16;
                    console.log(MARKER + JSON.stringify([
                        'DATA',
                        location,
                        text.replace(DUMP_PAYLOAD, (_all, a) => a).replace(/[^a-f0-9]/g, '')
                    ]));
                }
                if (/^bldr>/.test(text.trim())) {
                    console.log("Found bldr>");
                    return true;
                }
            });
        });
        if (!crashed) { break; }
        console.log(MARKER + JSON.stringify(['CRASH', continueFrom.toString(16)]));
        // Advance by one page
        continueFrom = Math.floor((continueFrom / 4096) + 1) * 4096;
        if (continueFrom > end) { break; }
        remainingLength = end - continueFrom;
        console.log("Restarting from 0x" + continueFrom.toString(16));
    }
    console.log('done done done');
}

const usage = () => {
    console.log('Usage: node memdump.js <tty> <relayTTY> <relayChannel> <start> <end>');
    console.log('  tty:             Serial device to dump memory from');
    console.log('  relayTTY:        Serial device to control relay');
    console.log('  relayChannel:    Relay channel to power cycle');
    console.log('  start:           Start address to dump');
    console.log('  end:             End address to dump');
}

const main = () => {
    if (process.argv.length < 6) {
        return void usage();
    }
    const [ tty, relayTTY, relayChannelS, startS, endS ] = process.argv.slice(2);
    if (!Fs.existsSync(tty)) {
        console.log(`Serial device ${tty} does not exist`);
        return void usage();
    } else if (!Fs.existsSync(relayTTY)) {
        console.log(`Serial device ${relayTTY} does not exist`);
        return void usage();
    }
    const relayChannel = Number(relayChannelS);
    const start = Number(startS);
    const end = Number(endS);
    if (isNaN(relayChannel) || relayChannel != Math.floor(Math.abs(relayChannel))) {
        console.log(`Invalid relay channel: ${relayChannelS}`);
        return void usage();
    }
    if (isNaN(start) || start != Math.floor(Math.abs(start))) {
        console.log(`Invalid start address: ${startS}`);
        return void usage();
    }
    if (isNaN(end) || end != Math.floor(Math.abs(end))) {
        console.log(`Invalid end: ${endS}`);
        return void usage();
    }
    run(tty, relayTTY, relayChannel, start, end)
        .catch(err => console.error('Error:', err));
};
main();