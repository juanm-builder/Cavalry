#!/usr/bin/env node
// Generates an Apple client-secret JWT for Sign in with Apple.
//
// Everything happens locally. The .p8 key is read from disk, used to sign, and
// never transmitted or written anywhere.
//
//   node apple-client-secret.mjs \
//     --key ~/secure/AuthKey_ABCD123456.p8 \
//     --key-id ABCD123456 \
//     --team-id U8H23USGUJ \
//     --client-id com.juanmbuilder.cavalry.auth
//
// Apple caps the lifetime at 6 months (15777000s). Default is just under that.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_LIFETIME_SECONDS = 15_777_000;

function parseArguments(argv) {
  const options = new Map();
  const stray = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      stray.push(token);
      continue;
    }
    const [flag, inlineValue] = token.slice(2).split('=');
    options.set(flag, inlineValue ?? argv[++index]);
  }
  // An unquoted path containing a space arrives here split across arguments.
  // Reporting that beats letting the truncated path fail as a bare ENOENT.
  if (stray.length > 0) {
    console.error(
      `Unexpected argument(s): ${stray.join(' ')}\n` +
        'This usually means a path with a space was not quoted. Note that ~ does\n' +
        'not expand inside double quotes, so prefer "$HOME/path with spaces/key.p8".'
    );
    process.exit(1);
  }
  return options;
}

function required(options, flag) {
  const value = String(options.get(flag) || '').trim();
  if (!value) {
    console.error(`Missing required --${flag}`);
    process.exit(1);
  }
  return value;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const options = parseArguments(process.argv.slice(2));
const keyPath = required(options, 'key');
const keyId = required(options, 'key-id');
const teamId = required(options, 'team-id');
const clientId = required(options, 'client-id');
const lifetime = Math.min(
  Number(options.get('lifetime-seconds') || MAX_LIFETIME_SECONDS - 3_600),
  MAX_LIFETIME_SECONDS
);

let privateKey;
try {
  privateKey = readFileSync(keyPath, 'utf8');
} catch (error) {
  console.error(`Could not read the key at ${keyPath}: ${error.message}`);
  process.exit(1);
}

if (!privateKey.includes('BEGIN PRIVATE KEY')) {
  console.error(
    'That file is not a PKCS#8 private key. Use the AuthKey_XXXXXXXXXX.p8 downloaded from Apple.'
  );
  process.exit(1);
}

const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + lifetime;

const header = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = base64Url(
  JSON.stringify({
    iss: teamId,
    iat: issuedAt,
    exp: expiresAt,
    aud: 'https://appleid.apple.com',
    sub: clientId
  })
);

// Apple requires a JOSE (r||s) signature. Node emits DER for EC unless told
// otherwise, and a DER signature fails Apple's validation with an opaque error.
const signer = createSign('SHA256');
signer.update(`${header}.${payload}`);
const signature = signer
  .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

process.stderr.write(
  `client_id (sub): ${clientId}\n` +
    `team_id  (iss): ${teamId}\n` +
    `key_id   (kid): ${keyId}\n` +
    `expires:        ${new Date(expiresAt * 1000).toISOString()}\n\n`
);
process.stdout.write(`${header}.${payload}.${signature}\n`);
