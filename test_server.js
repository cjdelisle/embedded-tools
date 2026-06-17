// SPDX-License-Identifier: GPL-2.0-only
/*
 * The Test Server allows running test_device.js remotely.
 *
 * Starting a test:
 *
 * curl -X POST http://device:3000/run \
 *   -F "password=secret" \
 *   -F "device=smartfiber_xp8421_b" \
 *   -F "file=@./build.trx"
 * 
 * Output: {"id":"550e8400-..."}
 * 
 * Checking on the test status:
 * # First poll — get everything
 * curl "http://device:3000/logs/550e8400-...?since=0"
 *
 * # Subsequent polls — pass the ts of the last log line received
 * curl "http://device:3000/logs/550e8400-...?since=1718620012400"
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { password, port } = require('./config.js').testServer;
const SCRIPT = process.env.TEST_SCRIPT || "./test_device.js";

if (!password) {
	console.error("ERROR: password is required.");
	process.exit(1);
}

const ARGUMENT_RE = /^[a-zA-Z0-9_]+$/;

// jobs[id] = { status, exitCode, tmpFile, logs: [{ ts, line }] }
const jobs = {};

function jsonResponse(res, statusCode, body) {
	const payload = JSON.stringify(body);
	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

function parseMultipart(req) {
	return new Promise((resolve, reject) => {
		const contentType = req.headers["content-type"] || "";
		const boundaryMatch = contentType.match(/boundary=("?)([^";]+)\1/);
		if (!boundaryMatch) {
			return reject(new Error("Missing or invalid multipart boundary"));
		}
		const boundary = boundaryMatch[2];

		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("error", reject);
		req.on("end", () => {
			try {
				const body = Buffer.concat(chunks);
				const result = splitMultipart(body, boundary);
				resolve(result);
			} catch (err) {
				reject(err);
			}
		});
	});
}

function splitMultipart(body, boundary) {
	const boundaryBuf = Buffer.from("--" + boundary);
	const CRLF = Buffer.from("\r\n");

	const fields = {};
	let file = null;

	// Find all part start positions
	let pos = 0;
	const partStarts = [];

	while (pos < body.length) {
		const idx = body.indexOf(boundaryBuf, pos);
		if (idx === -1) break;
		pos = idx + boundaryBuf.length;
		// Skip \r\n after boundary, or -- for final boundary
		if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // "--"
		if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
		partStarts.push(pos);
	}

	for (const start of partStarts) {
		// Find end of headers
		const headerEnd = body.indexOf("\r\n\r\n", start);
		if (headerEnd === -1) continue;

		const headerStr = body.slice(start, headerEnd).toString();
		// Part data runs from after \r\n\r\n to just before next boundary \r\n--boundary
		const dataStart = headerEnd + 4;
		const nextBoundary = body.indexOf("\r\n" + "--" + boundary, dataStart);
		const dataEnd = nextBoundary === -1 ? body.length : nextBoundary;
		const data = body.slice(dataStart, dataEnd);

		const nameMatch = headerStr.match(/name="([^"]+)"/);
		const filenameMatch = headerStr.match(/filename="([^"]+)"/);
		if (!nameMatch) continue;

		const fieldName = nameMatch[1];

		if (filenameMatch) {
			file = {
				filename: path.basename(filenameMatch[1]) || "upload",
				buffer: data,
			};
		} else {
			fields[fieldName] = data.toString();
		}
	}

	return { fields, file };
}

async function handleRun(req, res) {
	let parsed;
	try {
		parsed = await parseMultipart(req);
	} catch (err) {
		return jsonResponse(res, 400, { error: `Multipart parse error: ${err.message}` });
	}

	const { fields, file } = parsed;

	// Auth
	if (fields.password !== password) {
		return jsonResponse(res, 401, { error: "Unauthorized" });
	}

	// Argument validation
	const device = fields.device;
	if (!device || !ARGUMENT_RE.test(device)) {
		return jsonResponse(res, 400, {
			error: "'device' is required and must match /^[a-zA-Z0-9_]+$/",
		});
	}

	if (jobs[device] && jobs[device].status === 'running') {
		return jsonResponse(res, 400, {
			error: `There already exists a job for ${device}`,
		});
	}

	// File
	if (!file) {
		return jsonResponse(res, 400, { error: "A file upload is required" });
	}

	// Store file in /tmp with a unique name, preserving extension if any
	const ext = path.extname(file.filename);
	const tmpPath = path.join("/tmp", `runner_${device}${ext}`);
	try {
		fs.writeFileSync(tmpPath, file.buffer);
	} catch (err) {
		return jsonResponse(res, 500, { error: `Failed to write upload: ${err.message}` });
	}

	// Create job
	jobs[device] = { status: "running", exitCode: null, tmpFile: tmpPath, logs: [] };

	// Run: node ./test_device.js <device> <tmpPath>
	const child = spawn("node", [SCRIPT, device, tmpPath], {
		cwd: process.cwd(),
	});

	console.log(`${device} STARTING`);

	function appendLine(line) {
		const ts = Date.now();
		console.log(`${device}/${ts}: ${line}`);
		jobs[device].logs.push({ ts, line });
	}

	function handleStream(stream) {
		let buf = "";
		stream.on("data", (chunk) => {
			buf += chunk.toString();
			const lines = buf.split("\n");
			buf = lines.pop();
			for (const line of lines) appendLine(line);
		});
		stream.on("end", () => {
			if (buf) appendLine(buf);
		});
	}

	handleStream(child.stdout);
	handleStream(child.stderr);

	child.on("close", (code) => {
		jobs[device].status = code === 0 ? "done" : "error";
		jobs[device].exitCode = code;
		// Clean up tmp file
		fs.unlink(tmpPath, () => {});
		console.log(`${device}: END SUCCESS`);
	});

	child.on("error", (err) => {
		appendLine(`[runner] Failed to start process: ${err.message}`);
		jobs[device].status = "error";
		jobs[device].exitCode = -1;
		fs.unlink(tmpPath, () => {});
		console.log(`${device}: END ERROR`);
	});

	return jsonResponse(res, 202, { device });
}

function handleLogs(req, res, id) {
	const job = jobs[id];
	if (!job) {
		return jsonResponse(res, 404, { error: "Job not found" });
	}

	const url = new URL(req.url, `http://localhost:${port}`);
	const sinceParam = url.searchParams.get("since");
	const since = sinceParam !== null ? parseInt(sinceParam, 10) : 0;

	if (isNaN(since)) {
		return jsonResponse(res, 400, {
			error: "'since' must be an integer millisecond timestamp",
		});
	}

	const filteredLogs =
		since > 0 ? job.logs.filter((e) => e.ts > since) : job.logs;

	return jsonResponse(res, 200, {
		id,
		status: job.status,
		exitCode: job.exitCode,
		logs: filteredLogs,
	});
}

const server = http.createServer(async (req, res) => {
	const { method, url } = req;

	if (method === "POST" && url === "/run") {
		return handleRun(req, res);
	}

	const logsMatch = url.match(/^\/logs\/([^/?]+)/);
	if (method === "GET" && logsMatch) {
		return handleLogs(req, res, logsMatch[1]);
	}

	return jsonResponse(res, 404, { error: "Not found" });
});

server.listen(port, () => {
	console.log(`runner listening on port ${port}`);
	console.log(`test script: ${SCRIPT}`);
});
