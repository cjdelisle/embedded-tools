# Embedded Tools

* `config.js` - Configuration of the USB ports of your devices and relay numbers
* `device.js` - Parse config.js and get the correct /dev/ttyUSB and relay number for a device by name
* `relay.js` - Controller for SainSmart (compatible) 16 line USB serial controlled relay
* `serial.js` - Lib for allowing you to write expect-like scripts for interfacing with modems
* `util.js` - Generic crap
* `memdump.js` - Read a range of memory in the bootloader, reset the relay if the device hangs
* `parse_memdump.js` - Parse the output of memdump.js and generate CSV files of 16 pages each

## mtddump.sh (does not require relay)
This will dump and validate an image file of an mtd on the device. This can be used with a generic
image that offers `mtd0` which covers the entire flash chip. This requires the device to have
`hexdump`, `sha256sum`, `gzip`, and `dd` (all available in busybox).

1. Connect to the device with your terminal in logging to a file (e.g. `my_device_mtddump.log`)
2. Paste the content of `mtddump.sh` into a shell on the device
3. Run `mtddump` command on the shell
4. **Don't press any keys, it will spoil the dump**
5. When it's complete, you will be back to a shell again (at this point, pressing keys is okay).
Disconnect your terminal so you have the complete log file.
6. Run `node parse_mtddump.js my_device_mtddump.log -o my_device_mtddump.bin` to reconstitute the
data from the dump, if there is any problem, it will error out.

If `parse_mtddump.js` completes successfully, you will have a complete image of the mtd from the