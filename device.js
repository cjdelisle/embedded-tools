const fs = require('fs').promises;
const path = require('path');

const Config = require('./config.js');

const findDeviceByPath = module.exports.findDeviceByPath = async (targetPath) => {
  try {
    // Directory where USB devices are listed
    const usbDir = '/sys/bus/usb/devices/';
    const entries = await fs.readdir(usbDir);

    // Look for the device matching the target path
    for (const entry of entries) {
        if (entry !== targetPath) {
          continue;
        }
        const ttyEntries = await fs.readdir(path.join(usbDir, entry));
        for (const ttyEntry of ttyEntries) {
          if (ttyEntry.startsWith('tty')) {
            const ttyPath = path.join('/', 'dev', ttyEntry);
            return ttyPath;
          }
        }
    }

    console.error(`No ttyUSB device found for path ${targetPath}`);
    return null;
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  }
}

const main = async () => {
  if (process.argv.length < 4) {
    console.error('Usage: node device.js relay <device_name>     # Relay number of the device');
    console.error('       node device.js usb <device_name>       # USB device name');
    process.exit(1);
  }
  const deviceName = process.argv.pop();
  const type = process.argv.pop();
  if (type !== 'relay' && type !== 'usb') {
    console.error(`Unknown type: ${type}`);
    process.exit(1);
  }
  const device = Config.DEVICES[deviceName];
  if (!device) {
    console.error(`Unknown device name: ${deviceName}`);
    process.exit(1);
  }
  if (type === 'relay') {
    console.log(''+device.relay);
    return;
  }
  const devicePath = device[type];
  const dp = await findDeviceByPath(devicePath);
  if (!dp) {
    console.error(`Device not found: ${devicePath}`);
    process.exit(1);
  }
  console.log(dp);
};

if (require.main === module) {
  main();
}
