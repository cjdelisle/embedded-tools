// SPDX-License-Identifier: GPL-2.0-only
const Fs = require('fs');
const { Serial } = require('./serial.js');
const { doRelayTask } = require('./relay.js');
const XModem = require('xmodem.js');

const { try_until } = require('./util.js');
const { findDeviceByPath } = require('./device.js');
const Config = require('./config.js');
const DeviceTests = require('./device_tests.js');

async function run(tty, relayTTy, relayChannel, testFile, deviceName) {
	doRelayTask(relayTTy, `channel-${relayChannel}-reset`);
	await Serial(tty, async (serial) => {
		serial.onNoOutput(() => {
			console.log('No output for 300 seconds');
			process.exit(1);
		}, 300000);
		await serial.waitText((text) => /enter boot command mode/.test(text));
		serial.sendText('');
		await serial.waitText((text) => {
			if (/UserName/.test(text)) {
				serial.sendText('telecomadmin');
			} else if (/Password/.test(text)) {
				serial.sendText('nE7jA%5m');
			} else if (/bldr>/.test(text)) {
				return true;
			}
			return false;
		});

		serial.sendText(`xmdm 80020000 ${testFile.length.toString(16)}`);
		await serial.sendXmdm(testFile);
		serial.sendText(`flash 80000 80020000 ${testFile.length.toString(16)}`);
		await serial.waitText((text) => /bldr/.test(text));

		setTimeout(() => {
			console.log(`Test did not complete after 10 minutes`);
			process.exit(1);
		}, 60 * 60 * 1000);

		serial.sendText(`go`);

		await serial.waitText((text) => /Please press Enter to activate this console/.test(text));

		for (const testname in DeviceTests) {
			await try_until(
				() => serial.sendText(``),
				() => serial.waitText((text) => /root@OpenWrt/.test(text))
			);

			console.log(`RUNNING TEST: ${testname}`);
			const failed = await DeviceTests[testname](serial, deviceName);
			if (failed) {
				console.log(`TEST FAILED: ${testname}: ${failed}`);
				process.exit(1);
				ret = -1;
				return;
			}
		}

		console.log(`TESTS PASSED`);
		process.exit(0);
	});
	console.log(`done done done ${ret}`);
	return ret;
}

const usage = () => {
	console.log('Usage: node test_device.js <device_id> <file_upload>');
	console.log('  device_id:	   The name of the device as identified in config.js');
	console.log('  file_upload:	 The TRX file to flash to the device before testing');
};

const main = async () => {
	if (process.argv.length < 2) {
		return void usage();
	}
	const [ deviceName, fileUpload ] = process.argv.slice(2);

	if (!Config.DEVICES[deviceName]) {
		console.log(`No such device specified: ${deviceName}`);
		return void usage();
	}
	const tty = await findDeviceByPath(Config.DEVICES[deviceName].usb);
	const relayTTY = await findDeviceByPath(Config.DEVICES.relay.usb);
	const relayChannel = Config.DEVICES[deviceName].relay;

	if (!Fs.existsSync(tty)) {
		console.log(`Serial device ${tty} does not exist`);
		return void usage();
	} else if (!Fs.existsSync(relayTTY)) {
		console.log(`Serial device ${relayTTY} does not exist`);
		return void usage();
	} else if (!Fs.existsSync(fileUpload)) {
		console.log(`File ${fileUpload} does not exist`);
		return void usage();
	} else if (isNaN(relayChannel) || relayChannel != Math.floor(Math.abs(relayChannel))) {
		console.log(`Invalid relay channel: ${relayChannelS}`);
		return void usage();
	}
	const file = Fs.readFileSync(fileUpload);
	run(tty, relayTTY, relayChannel, file, deviceName)
		.catch(err => {
			console.error('Error:', err);
			process.exit(1);
		});

	setTimeout(() => {
		console.log(`test_device.js has been running for 60 minutes`);
		process.exit(1);
	}, 60 * 60 * 1000);
};
main();
