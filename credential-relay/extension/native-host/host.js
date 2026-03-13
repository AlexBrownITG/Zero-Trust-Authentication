#!/usr/bin/env node
/**
 * Native Messaging Host for Credential Relay.
 *
 * Chrome sends/receives messages via stdin/stdout using a
 * length-prefixed JSON protocol (4-byte LE length + JSON payload).
 *
 * This host forwards requests to the agent's IPC socket and
 * returns responses back to the extension.
 */

const net = require('net');
const path = require('path');

const IPC_SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\credential-relay'
  : '/tmp/credential-relay.sock';

// --- Chrome Native Messaging Protocol ---

function readMessage() {
  return new Promise((resolve, reject) => {
    // Read 4-byte length header
    const headerBuf = [];
    let headerLen = 0;

    function onReadable() {
      while (headerLen < 4) {
        const chunk = process.stdin.read(4 - headerLen);
        if (!chunk) return; // wait for more data
        headerBuf.push(chunk);
        headerLen += chunk.length;
      }

      process.stdin.removeListener('readable', onReadable);

      const header = Buffer.concat(headerBuf);
      const msgLen = header.readUInt32LE(0);

      if (msgLen === 0 || msgLen > 1024 * 1024) {
        return reject(new Error(`Invalid message length: ${msgLen}`));
      }

      // Read message body
      const bodyBuf = [];
      let bodyLen = 0;

      function onBodyReadable() {
        while (bodyLen < msgLen) {
          const chunk = process.stdin.read(msgLen - bodyLen);
          if (!chunk) return;
          bodyBuf.push(chunk);
          bodyLen += chunk.length;
        }
        process.stdin.removeListener('readable', onBodyReadable);
        const body = Buffer.concat(bodyBuf).toString('utf8');
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body}`));
        }
      }

      process.stdin.on('readable', onBodyReadable);
      onBodyReadable();
    }

    process.stdin.on('readable', onReadable);
    onReadable();
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// --- IPC Client ---

function sendToAgent(request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(IPC_SOCKET_PATH, () => {
      socket.write(JSON.stringify(request) + '\n');
    });

    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const newlineIdx = data.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = data.slice(0, newlineIdx);
        socket.destroy();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`Invalid response from agent: ${line}`));
        }
      }
    });

    socket.on('error', (err) => {
      reject(new Error(`Agent connection failed: ${err.message}`));
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('Agent connection timed out'));
    });
  });
}

// --- Main Loop ---

async function main() {
  process.stdin.resume();

  while (true) {
    try {
      const msg = await readMessage();

      if (msg.action === 'ping') {
        sendMessage({ ok: true, data: 'pong' });
        continue;
      }

      // Forward to agent IPC
      const response = await sendToAgent(msg);
      sendMessage(response);
    } catch (err) {
      // If stdin closed, exit gracefully
      if (err.message.includes('Invalid message length: 0')) {
        process.exit(0);
      }
      sendMessage({ ok: false, error: err.message });
    }
  }
}

main().catch(() => process.exit(1));
