const USB = module.exports.USB = Object.freeze({
    // These are the ports in a USB hub, used to resolve ttyUSB numbers based
    // on which physical socket the device is plugged into.
    bus0: [
        '1-1.3:1.0',
        '1-1.4:1.0',
        '1-1.2:1.0',
        '1-1.1.3:1.0',
        '1-1.1.4:1.0',
        '1-1.1.2:1.0',
        '1-1.1.1:1.0',
    ],
});

module.exports.DEVICES = Object.freeze({
    // Devices by name, giving the USB port and relay number.
    relay:                  { usb: USB.bus0[6], relay: -1 },
    smartfiber_xp8421_b:    { usb: USB.bus0[0], relay: 1 },
    zikun_521x6:            { usb: USB.bus0[1], relay: 15 },
    smartfiber_xp8100:      { usb: USB.bus0[2], relay: 3 },
    archer_vr1200v_v2:      { usb: USB.bus0[3], relay: 4 },
});