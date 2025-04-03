const Fs = require('fs');

const MARKER = '-----DUMP-LINE----- ';

// Each csv is 16 pages
const PAGE = 4096;
const PPS = 16;
const SHEET = PAGE * PPS;

const makeCsv = (map, baseAddr) => {
    const out = [];
    {
        const col = [];
        for (let i = 0; i < PAGE; i += 4) {
            // index column
            col.push(i.toString(16).padStart(3,'0'));
        }
        out.push(col);
    }
    for (let i = 0; i < 16; i++) {
        const col = [];
        for (let j = 0; j < (PAGE/PPS); j++) {
            const addr = baseAddr + i * PAGE + j * PPS;
            let val;
            for (let ta = addr; !val && ta < addr + 16; ta += 4) {
                val = map[ta.toString(16)];
            }
            if (val) {
                if (val[0] === 'DATA') {
                    let v = val[1];
                    while (v !== '') {
                        col.push('0x' + v.slice(0, 8));
                        v = v.slice(8);
                    }
                } else {
                    for (let k = 0; k < PPS; k++) {
                        col.push(val[0]);
                    }
                }
            } else {
                // console.log(addr.toString(16), 'MISSING');
                for (let k = 0; k < PPS; k++) {
                    col.push('MISSING');
                }
            }
        }
        out.push(col);
    }
    const csv = [];
    {
        const msg = ['-'];
        let addr = baseAddr;
        for (let j = 0; j < 16; j++) {
            msg.push('0x' + (addr / PAGE).toString(16).padStart(5, '0'));
            addr += PAGE;
        }
        csv.push(msg.join());
    }
    for (let i = 0; i < 1024; i++) {
        const msg = [];
        for (let j = 0; typeof(out[j]) !== 'undefined'; j++) {
                msg.push(out[j][i]);
        }
        csv.push(msg.join());
    }
    return csv.join('\n');
};

const compute = (map, lowest, highest, filename) => {
    const l = Math.floor(lowest / SHEET) * SHEET;
    if (lowest !== l) {
        console.log(`Missing data from 0x${lowest.toString(16)} to 0x${l.toString(16)}`);
    }
    const h = Math.ceil(highest / SHEET) * SHEET;
    if (highest !== h) {
        console.log(`Missing data from 0x${highest.toString(16)} to 0x${h.toString(16)}`);
    }

    console.log(`Processing between 0x${lowest.toString(16)} and 0x${highest.toString(16)}`);
    while (lowest < highest) {
        console.log("makeSheet " + lowest.toString(16));
        const csv = makeCsv(map, lowest);
        const file = `${filename}.0x${lowest.toString(16)}.csv`;
        console.log(`Writing to ${file}`);
        Fs.writeFileSync(file, csv);
        lowest += SHEET;
    }
}

const parse = (txt, filename) => {
    const map = {};
    let lowest = 0xffffffff;
    let highest = 0;
    for (line of txt.split('\n')) {
        if (line.indexOf(MARKER) !== -1) {
            const d = JSON.parse(line.slice(MARKER.length));
            if (d[0] === 'DATA') {
                map[d[1]] = [ 'DATA', d[2] ];
            } else if (d[0] === 'CRASH') {
                map[d[1]] = [ 'CRASH' ];
            } else {
                continue;
            }
            const n = Number('0x' + d[1]);
            if (n < lowest) {
                lowest = n;
            }
            if (n > highest) {
                highest = n;
            }
        }
    }
    compute(map, lowest, highest + 16, filename);
};

const usage = () => {
    console.log("Usage: node parse_memdump.js <memdump-file>");
};

const main = () => {
    if (process.argv.length !== 3) {
        usage();
        process.exit(1);
    }
    const src = process.argv[2];
    if (!Fs.existsSync(src)) {
        console.log(`File not found: ${src}`);
        process.exit(1);
    }
    const txt = Fs.readFileSync(src, 'utf8');
    parse(txt, src);
};

main();