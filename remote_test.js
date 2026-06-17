#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
/**
 * remote_test.js — CI client for runner.js
 *
 * Usage:
 *   PASSWORD=secret node remote_test.js <server_url> <device_id> <file_path>
 *
 * Example:
 *   PASSWORD=secret node remote_test.js https://my.server:8889 device_abc ./test.trx
 *
 * Streams logs to stdout in real time, exits with the remote process's exit code.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PASSWORD = process.env.PASSWORD;
const [serverUrl, deviceId, filePath] = process.argv.slice(2);

if (!PASSWORD || !serverUrl || !deviceId || !filePath) {
	console.error(
		"Usage: PASSWORD=<password> node remote_test.js <server_url> <device_id> <file_path>"
	);
	process.exit(1);
}

if (!/^[a-zA-Z0-9_]+$/.test(deviceId)) {
	console.error("Error: device_id must match /^[a-zA-Z0-9_]+$/");
	process.exit(1);
}

if (!fs.existsSync(filePath)) {
	console.error(`Error: file not found: ${filePath}`);
	process.exit(1);
}

function request(url, options = {}, bodyBuffer = null) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const lib = parsed.protocol === "https:" ? https : http;
		const req = lib.request(url, options, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => {
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString());
					resolve({ statusCode: res.statusCode, body });
				} catch (err) {
					reject(new Error(`Failed to parse response JSON: ${err.message}`));
				}
			});
		});
		req.on("error", reject);
		if (bodyBuffer) req.write(bodyBuffer);
		req.end();
	});
}

function buildMultipart(fields, file) {
	const boundary = "----RemoteTestBoundary" + randomUUID().replace(/-/g, "");
	const parts = [];

	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
			)
		);
	}

	const filename = path.basename(file.path);
	parts.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
		),
		file.buffer,
		Buffer.from("\r\n")
	);

	parts.push(Buffer.from(`--${boundary}--\r\n`));

	return {
		boundary,
		body: Buffer.concat(parts),
	};
}

async function main() {
	// 1. Upload file and start job
	const fileBuffer = fs.readFileSync(filePath);
	const { boundary, body } = buildMultipart(
		{ password: PASSWORD, device: deviceId },
		{ path: filePath, buffer: fileBuffer }
	);

	console.error(`[remote_test] Submitting job to ${serverUrl} (device: ${deviceId}, file: ${filePath})`);

	let submitRes;
	try {
		submitRes = await request(
			`${serverUrl}/run`,
			{
				method: "POST",
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"Content-Length": body.length,
				},
			},
			body
		);
	} catch (err) {
		console.error(`[remote_test] Failed to connect to server: ${err.message}`);
		process.exit(1);
	}

	if (submitRes.statusCode !== 202) {
		console.error(`[remote_test] Server rejected request (HTTP ${submitRes.statusCode}):`, submitRes.body);
		process.exit(1);
	}

	const { device } = submitRes.body;
	console.error(`[remote_test] Job started, id: ${device}`);

	// 2. Poll for logs
	const POLL_INTERVAL_MS = 500;
	let since = 0;

	while (true) {
		await sleep(POLL_INTERVAL_MS);

		let pollRes;
		try {
			pollRes = await request(`${serverUrl}/logs/${device}?since=${since}`);
		} catch (err) {
			console.error(`[remote_test] Poll error: ${err.message} — retrying...`);
			continue;
		}

		if (pollRes.statusCode !== 200) {
			console.error(`[remote_test] Unexpected poll response (HTTP ${pollRes.statusCode}):`, pollRes.body);
			process.exit(1);
		}

		const { status, exitCode, logs } = pollRes.body;

		for (const entry of logs) {
			console.log(entry.line);
			if (entry.ts > since) since = entry.ts;
		}

		if (status === "done" || status === "error") {
			console.error(`[remote_test] Job finished — status: ${status}, exitCode: ${exitCode}`);
			process.exit(exitCode ?? 1);
		}
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
