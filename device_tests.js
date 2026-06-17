// SPDX-License-Identifier: GPL-2.0-only
const { try_until } = require('./util.js');
const { SSID, TEST_EXPECT } = require('./config.js');

const command = async (serial, command) => {
	serial.sendText(command);
	let kmsg = false;
	await try_until(
		() => {
			if (kmsg) {
				serial.sendText('');
			}
		},
		() => serial.waitText((text) => {
			if (/root@OpenWrt/.test(text)) { return true; }
			kmsg = (text.indexOf('[') === 0);
			return false;
		}),
	);
};

const wifiPhyScan = async (serial, phy) => {
	const aps = [];
	let ap;
	let failed;
	await command(serial, `iw phy ${phy} interface add wlan${phy} type station`);
	await command(serial, `ip link set wlan${phy} up`);
	serial.sendText(`iw dev wlan${phy} scan`);
	await serial.waitText((text) => {
		if (/root@OpenWrt/.test(text)) { return true; }
		text.replace(/^\s*BSS ([0-9a-f:]+)\(/, (all, bssid) => {
			console.log(`GOT BSSID ${bssid}`);
			ap = { bssid };
		});
		if (!ap) {
			return false;
		}
		if (/^\s*freq:/.test(text)) {
			ap.freq = text.split(' ').pop();
			console.log(`GOT FREQ ${ap.freq}`);
			if (isNaN(Number(ap.freq))) {
				failed = new Error(`Freq [${text}] not parsed correctly`);
			}
		}
		if (/^\s*SSID:/.test(text)) {
			const ssid = text.split(' ').pop();
			console.log(`GOT SSID ${ssid}`);
			if (ssid === SSID.name) {
				aps.push(ap);
			} else {
				console.log(`DISCARDING NON-TEST SSID ${ssid}`);
			}
			ap = null;
		}
		return false;
	});
	return { aps, failed };
};

const wifiTestPhy = async (serial, phy, deviceName) => {
	const aps = [];

	let missing = [];
	for (let i = 0; i < 3; i++) {
		const ret = await wifiPhyScan(serial, phy);
		if (ret.failed) {
			return ret.failed;
		}
		missing = [];
		if (TEST_EXPECT[deviceName] &&
			TEST_EXPECT[deviceName].wifi &&
			TEST_EXPECT[deviceName].wifi[phy] &&
			TEST_EXPECT[deviceName].wifi[phy].bands)
		{
			const bands = [];
			bands.push(...TEST_EXPECT[deviceName].wifi[phy].bands);

			while (bands.length) {
				const b = bands.pop();
				let found = false;
				for (let ap of ret.aps) {
					if (Math.floor(Number(ap.freq) / 1000) === b) {
						aps.push(ap);
						found = true;
						console.log(`USING AP ${JSON.stringify(ap)}`);
						break;
					} else {
						console.log(`SKIP AP ${JSON.stringify(ap)} BAND NOT SUPPORTED`);
					}
				}
				if (!found) {
					missing.push(b);
				}
			}
		} else {
			console.log(`BANDS NOT SPECIFIED, USING ALL`);
			aps.push(...ret.aps);
		}
		if (missing.length) {
			console.log(`MISSING BANDS: ${missing}`);
		} else {
			break;
		}
	}
	if (missing.length) {
		console.log(`MISSING BANDS: ${missing} after 3 tries`);
	}

	serial.sendText([
		`for i in 0 1; do`,
		`rpath=$(uci get wireless.radio$i.path);`,
		`ls /sys/devices/platform/$rpath/ieee80211 | grep -q ${phy} &&`,
		`echo RADIO_ID $i;`,
		`done`
	].join(' '));
	let radioId;
	await serial.waitText((text) => {
		if (/RADIO_ID [0-9]/.test(text)) {
			radioId = text.split(' ').pop();
			return false;
		} else if (/root@OpenWrt/.test(text)) {
			return true;
		}
	});
	if (isNaN(Number(radioId))) {
		return new Error(`Radio ID [${text}] not parsed correctly`);
	}

	for (let ap of aps) {
		console.log(`TESTING AP ${JSON.stringify(ap)} ON ${phy}`);

		await command(serial, `uci set network.wwan=interface`);
		await command(serial, `uci set network.wwan.proto='dhcp'`);
		await command(serial, `uci commit network`);

		const dr = `wireless.default_radio${radioId}`;
		await command(serial, `uci set ${dr}.bssid='${ap.bssid}'`);
		await command(serial, `uci set ${dr}.mode='sta'`);
		await command(serial, `uci set ${dr}.network='wwan'`);
		await command(serial, `uci set ${dr}.ssid='${SSID.name}'`);
		await command(serial, `uci set ${dr}.encryption='psk2'`);
		await command(serial, `uci set ${dr}.key='${SSID.passwd}'`);
		await command(serial, `uci set ${dr}.disabled=0`);
		await command(serial, `uci commit wireless`);

		await command(serial, `service network start`);
		await command(serial, `wifi reload`);

		await try_until(
			() => serial.sendText(`ip addr show dev ${phy}-sta0`),
			() => serial.waitText((text) => /inet 192\.168\./.test(text))
		);

		console.log(`PING TESTING AP ${JSON.stringify(ap)} ON ${phy}`);
		const pingCount = 30;
		let responseCount = 0;
		serial.sendText(`ping -c ${pingCount} 192.168.1.254`);
		await serial.waitText((text) => {
			if (/root@OpenWrt/.test(text)) { return true; }
			if (/64 bytes from/.test(text)) { responseCount++; }
			return false;
		});
		if (responseCount === 0) {
			return new Error(`No ping reply on ${JSON.stringify(ap)} TESTING ${phy}`);
		}

		await command(serial, `uci set ${dr}.disabled=1`);
		await command(serial, `uci commit wireless`);
		await command(serial, `service network stop`);
	}

}

module.exports = {
	// Check for working console
	proc_cpuinfo: async (serial, deviceName) => {
		serial.sendText(`cat /proc/cpuinfo`);
		await serial.waitText((text) => /MIPS 34Kc V5.8/.test(text));
	},

	// Check working USB
	usb: async (serial, deviceName) => {
		await command(serial, `mkdir /tmp/usb`);
		await command(serial, `mount /dev/sda1 /tmp/usb`);
		serial.sendText(`cat /tmp/usb/scholars_and_warriors.txt`);
		await serial.waitText((text) => /thinking done by cowards and its fighting done by fools/.test(text));
	},

	// Test Ethernet
	ethernet: async (serial, deviceName) => {
		// Often we are racing the 
		await command(serial, `uci del network.@device[0].ports`);
		await command(serial, `service network stop`);
		await command(serial, `ifconfig eth0 up`);
		await command(serial, `udhcpc -i eth0`);

		serial.sendText(`ping 192.168.3.1`);
		await serial.waitText((text) => /64 bytes from/.test(text));
		await try_until(
			() => serial.sendText(String.fromCharCode(0x03)), // ctrl+c
			() => serial.waitText((text) => /root@OpenWrt/.test(text))
		);
		await command(serial, `ifconfig eth0 down`);
	},

	// Test wifi
	wifi: async (serial, deviceName) => {
		const phys = {};
		let current_phy;
		let failed;

		serial.sendText(`iw phy`);
		await serial.waitText((text) => {
			if (/root@OpenWrt/.test(text)) { return true; }
			if (/^Wiphy /.test(text)) {
				current_phy = text.split(' ').pop();
				phys[current_phy] = { freqs: [] };
				return false;
			}
			if (!/[0-9\.]+ MHz \[[0-9]+\]/.test(text)) {
				return false;
			} else if (text.indexOf('disabled') > -1) {
				return false;
			}
			const freq = text.replace(/^.* ([0-9\.]+) MHz \[[0-9]+\].*$/, (all, a) => a);
			if (isNaN(Number(freq))) {
				failed = new Error(`Freq [${text}] not parsed correctly (phy)`);
			}
			console.log(`Found freq ${text} on ${current_phy} (${freq})`);
			phys[current_phy].freqs.push(freq);
			return false;
		});

		console.log(`Found Wifi Devices: ${JSON.stringify(phys, null, '\t')}`);

		for (let phy in phys) {
			const err = await wifiTestPhy(serial, phy, deviceName);
			if (err) { return err; }
		}

		if (TEST_EXPECT[deviceName] && TEST_EXPECT[deviceName].wifi) {
			for (let phyname in TEST_EXPECT[deviceName].wifi) {
				if (!phys[phyname]) {
					return new Error(`No such PHY ${phyname}`);
				}
			}
		}
	},
};
