// Prototype for design §2.7 (how the sidecar trusts the server's self-signed
// certificate without NODE_EXTRA_CA_CERTS, which Node only reads at process
// start).
//
// Generates a throwaway self-signed certificate in the system temp dir (never
// the repo's certs/), starts an HTTPS server on 127.0.0.1:3199 (never 3000),
// and posts to it three ways:
//   A. global fetch, no CA               -> expected to fail (self-signed)
//   B. global fetch + undici Agent{ca}   -> expected to succeed
//   C. global fetch + undici Agent{ca}, wrong SAN -> expected to fail
// C is what proves the dispatcher still validates the hostname, i.e. that this
// is real TLS and not a rejectUnauthorized:false in disguise.
//
// Run from a directory with `undici` installed:  node probe-tls-dispatcher.mjs
import { Agent } from 'undici';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfslogger-tls-'));
const key = path.join(dir, 'key.pem');
const cert = path.join(dir, 'cert.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1',
]);

const server = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  (req, res) => { res.statusCode = 204; res.end(); },
);
await new Promise((r) => server.listen(3199, '127.0.0.1', r));

const body = JSON.stringify({ lat: 1, lon: 2 });
const headers = { 'Content-Type': 'application/json', 'x-ingest-token': 'PLACEHOLDER' };

async function attempt(label, dispatcher) {
  try {
    const res = await fetch('https://127.0.0.1:3199/api/ingest/frame', {
      method: 'POST', headers, body, dispatcher,
    });
    console.log(`${label}: HTTP ${res.status}`);
  } catch (err) {
    console.log(`${label}: FAILED — ${err.cause?.code ?? err.cause?.message ?? err.message}`);
  }
}

await attempt('A no-CA        ', undefined);
await attempt('B CA dispatcher', new Agent({ connect: { ca: fs.readFileSync(cert, 'utf8') } }));
await attempt('C CA + wrong host', new Agent({ connect: { ca: fs.readFileSync(cert, 'utf8'), servername: 'nope.example' } }));

server.close();
fs.rmSync(dir, { recursive: true, force: true });
