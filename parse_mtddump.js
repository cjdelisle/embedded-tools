const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');
const zlib = require('zlib');

async function parseHexdumpFile(inputFile, outputFile) {
    const fileStream = fs.createReadStream(inputFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let state = 'START'; // States: START, READING_BLOCK, READING_HEX
    let currentBlockNum = null;
    let currentHash = null;
    let currentBuffer = [];
    let readLines = 0;

    const outputStream = fs.createWriteStream(outputFile, { flags: 'w' });

    // Regular expressions for parsing
    const readPattern = /^READ (\d+)$/;
    const sha256Pattern = /^SHA256 (\d+) ([0-9a-f]{64})\s+.*$/i;
    const hexPattern = /^[0-9a-f]{8}\s+([0-9a-f]{2}(?:\s+[0-9a-f]{2}){0,15})\s+\|(.{0,16})\|$/i;
    const endPattern = /^[0-9a-f]{8}$/;

    for await (const line of rl) {
        switch (state) {
            case 'START':
                const readMatch = line.match(readPattern);
                if (readMatch) {
                    currentBlockNum = parseInt(readMatch[1], 10);
                    state = 'READING_BLOCK';
                    currentBuffer = [];
                    console.log(`Starting block ${currentBlockNum}`);
                }
                break;

            case 'READING_BLOCK':
                const sha256Match = line.match(sha256Pattern);
                if (sha256Match) {
                    const blockNum = parseInt(sha256Match[1], 10);
                    if (blockNum !== currentBlockNum) {
                        console.error(`Block number mismatch: expected ${currentBlockNum}, got ${blockNum}`);
                        return;
                    }
                    currentHash = sha256Match[2].toLowerCase();
                    state = 'READING_HEX';
                    readLines = 0;
                    console.log(`SHA256 for block ${currentBlockNum}: ${currentHash}`);
                }
                break;

            case 'READING_HEX':
                // Check for end of hexdump
                if (endPattern.test(line)) {
                    // Compute SHA256 of the current buffer
                    const compressedBuffer = Buffer.concat(currentBuffer);
                    // Decompress the gzipped buffer
                    const buffer = zlib.gunzipSync(compressedBuffer);
                    // Compute SHA256 on the decompressed data
                    const computedHash = crypto.createHash('sha256')
                        .update(buffer)
                        .digest('hex')
                        .toLowerCase();

                    if (computedHash !== currentHash) {
                        console.error(`Hash mismatch for block ${currentBlockNum}: expected ${currentHash}, got ${computedHash} (${readLines} lines)`);
                        return;
                    }

                    // Write the buffer to the output file
                    outputStream.write(buffer);
                    console.log(`Block ${currentBlockNum} verified and appended`);

                    // Reset for next block
                    state = 'START';
                    currentBlockNum = null;
                    currentHash = null;
                    currentBuffer = [];
                } else {
                    // Parse hexdump line
                    const hexMatch = line.match(hexPattern);
                    if (hexMatch) {
                        const hexString = hexMatch[1].replace(/\s+/g, ''); // Remove spaces
                        const blockBuffer = Buffer.from(hexString, 'hex');
                        currentBuffer.push(blockBuffer);
                        readLines += 1;
                    } else {
                        console.error(`Invalid hex line format: ${line}`);
                    }
                }
                break;
        }
    }

    outputStream.end();
    console.log('Parsing complete');
}

function printUsage() {
    console.log('Usage: node script.js <input_file> [-o <output_file>]');
    console.log('  <input_file>   : Path to the hexdump input file');
    console.log('  -o <output_file>: Optional output file (defaults to <input_file>.img)');
    process.exit(1);
}

function main() {
    // Parse command-line arguments
    const args = process.argv.slice(2); // Skip 'node' and script name

    // Check for input file
    if (args.length === 0) {
        printUsage();
    }

    const inputFile = args[0]; // First argument is the input file
    let outputFile;

    // Parse optional -o flag
    const outputIndex = args.indexOf('-o');
    if (outputIndex !== -1 && outputIndex + 1 < args.length) {
        outputFile = args[outputIndex + 1]; // Value after '-o'
    } else {
        // Default to input file name with .img extension
        outputFile = `${inputFile.replace(/\.[^/.]+$/, '')}.img`;
    }

    // Run the parser
    parseHexdumpFile(inputFile, outputFile)
        .catch(err => console.error('Error:', err));
}
main()