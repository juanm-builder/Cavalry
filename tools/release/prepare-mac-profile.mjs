#!/usr/bin/env node

import { createPrivateKey, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appStoreConnectApi = 'https://api.appstoreconnect.apple.com';
const expectedBundleIdentifier = 'com.juanmbuilder.cavalry.mac';
const supportedCertificateTypes = new Set([
  'DEVELOPER_ID_APPLICATION',
  'DEVELOPER_ID_APPLICATION_G2'
]);

function requiredValue(value, label, pattern) {
  const normalized = String(value || '').trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return normalized;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function createAppStoreConnectToken({ keyId, issuerId, privateKey, now = Date.now() }) {
  const normalizedKeyId = requiredValue(keyId, 'APPLE_API_KEY_ID', /^[A-Z0-9]{10,32}$/);
  const normalizedIssuerId = requiredValue(
    issuerId,
    'APPLE_API_ISSUER',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  const issuedAt = Math.floor(now / 1000);
  const header = base64UrlJson({ alg: 'ES256', kid: normalizedKeyId, typ: 'JWT' });
  const payload = base64UrlJson({
    iss: normalizedIssuerId,
    iat: issuedAt - 5,
    exp: issuedAt + 10 * 60,
    aud: 'appstoreconnect-v1'
  });
  const signingInput = `${header}.${payload}`;
  const signingKey =
    typeof privateKey === 'object' && privateKey?.type === 'private'
      ? privateKey
      : createPrivateKey(privateKey);
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: signingKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

function normalizedSerial(value) {
  return String(value || '')
    .replace(/[^0-9a-f]/gi, '')
    .replace(/^0+/, '')
    .toUpperCase();
}

export function selectBundleId(resources, identifier = expectedBundleIdentifier) {
  const matches = resources.filter((resource) => resource?.attributes?.identifier === identifier);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one registered bundle ID for ${identifier}; found ${matches.length}.`
    );
  }
  return matches[0];
}

export function selectDeveloperIdCertificate(resources, serialNumber, now = Date.now()) {
  const expectedSerial = normalizedSerial(
    requiredValue(serialNumber, 'APPLE_SIGNING_CERTIFICATE_SERIAL', /^[0-9a-f: ]+$/i)
  );
  const matches = resources.filter((resource) => {
    const attributes = resource?.attributes || {};
    const expiresAt = Date.parse(attributes.expirationDate || '');
    return (
      supportedCertificateTypes.has(attributes.certificateType) &&
      attributes.activated !== false &&
      Number.isFinite(expiresAt) &&
      expiresAt > now &&
      normalizedSerial(attributes.serialNumber) === expectedSerial
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      `Expected one active Developer ID Application certificate matching the release certificate; found ${matches.length}.`
    );
  }
  return matches[0];
}

export function selectMatchingProfile(resources, bundleId, certificateId, now = Date.now()) {
  return (
    resources
      .filter((resource) => {
        const attributes = resource?.attributes || {};
        const relatedBundle = resource?.relationships?.bundleId?.data?.id;
        const relatedCertificates = resource?.relationships?.certificates?.data || [];
        const expiresAt = Date.parse(attributes.expirationDate || '');
        return (
          attributes.profileType === 'MAC_APP_DIRECT' &&
          attributes.profileState === 'ACTIVE' &&
          Number.isFinite(expiresAt) &&
          expiresAt > now &&
          relatedBundle === bundleId &&
          relatedCertificates.some((certificate) => certificate?.id === certificateId) &&
          typeof attributes.profileContent === 'string' &&
          attributes.profileContent.length > 0
        );
      })
      .sort(
        (left, right) =>
          Date.parse(right.attributes.expirationDate) - Date.parse(left.attributes.expirationDate)
      )[0] || null
  );
}

export function decodeProfileContent(profileContent) {
  const normalized = String(profileContent || '').replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Apple returned invalid provisioning profile content.');
  }
  const profile = Buffer.from(normalized, 'base64');
  if (profile.length < 256) {
    throw new Error('Apple returned an unexpectedly small provisioning profile.');
  }
  return profile;
}

function summarizeApiError(body, statusText) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (!errors.length) return statusText || 'Unknown Apple API error';
  return errors
    .map((error) => [error?.status, error?.code, error?.title].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
}

async function requestJson(fetchImpl, token, path, options = {}) {
  const response = await fetchImpl(new URL(path, appStoreConnectApi), {
    ...options,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Apple provisioning API request failed with HTTP ${response.status}: ${summarizeApiError(body, response.statusText)}`
    );
  }
  return body;
}

async function listAll(fetchImpl, token, path) {
  const resources = [];
  let next = path;
  while (next) {
    const body = await requestJson(fetchImpl, token, next);
    resources.push(...(Array.isArray(body?.data) ? body.data : []));
    next = body?.links?.next || null;
  }
  return resources;
}

export async function prepareMacProvisioningProfile({
  keyId,
  issuerId,
  privateKey,
  certificateSerial,
  outputPath,
  fetchImpl = fetch,
  now = Date.now()
}) {
  const token = createAppStoreConnectToken({ keyId, issuerId, privateKey, now });
  const bundleQuery = new URLSearchParams({
    'filter[identifier]': expectedBundleIdentifier,
    'fields[bundleIds]': 'identifier,name,platform',
    limit: '2'
  });
  const bundles = await listAll(fetchImpl, token, `/v1/bundleIds?${bundleQuery}`);
  const bundle = selectBundleId(bundles);

  const certificateQuery = new URLSearchParams({
    'filter[certificateType]': [...supportedCertificateTypes].join(','),
    'fields[certificates]':
      'name,certificateType,displayName,serialNumber,platform,expirationDate,activated',
    limit: '200'
  });
  const certificates = await listAll(fetchImpl, token, `/v1/certificates?${certificateQuery}`);
  const certificate = selectDeveloperIdCertificate(certificates, certificateSerial, now);

  const profileQuery = new URLSearchParams({
    'filter[profileType]': 'MAC_APP_DIRECT',
    'filter[profileState]': 'ACTIVE',
    'fields[profiles]':
      'name,profileType,profileState,profileContent,expirationDate,bundleId,certificates',
    include: 'bundleId,certificates',
    limit: '200'
  });
  const profiles = await listAll(fetchImpl, token, `/v1/profiles?${profileQuery}`);
  let profile = selectMatchingProfile(profiles, bundle.id, certificate.id, now);
  let disposition = 'reused';

  if (!profile) {
    const serialSuffix = normalizedSerial(certificateSerial).slice(-8);
    const body = await requestJson(fetchImpl, token, '/v1/profiles', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'profiles',
          attributes: {
            name: `Cavalry Mac Developer ID ${serialSuffix}`,
            profileType: 'MAC_APP_DIRECT'
          },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: bundle.id } },
            certificates: {
              data: [{ type: 'certificates', id: certificate.id }]
            }
          }
        }
      })
    });
    profile = body?.data;
    disposition = 'created';
  }

  const profileBytes = decodeProfileContent(profile?.attributes?.profileContent);
  const destination = resolve(requiredValue(outputPath, 'profile output path'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, profileBytes, { mode: 0o600 });
  return { destination, disposition };
}

function outputArgument(argv) {
  const index = argv.indexOf('--output');
  if (index < 0 || !argv[index + 1]) {
    throw new Error('Usage: prepare-mac-profile.mjs --output <profile-path>');
  }
  return argv[index + 1];
}

async function main() {
  const privateKeyPath = requiredValue(process.env.APPLE_API_KEY_PATH, 'APPLE_API_KEY_PATH');
  const privateKey = await readFile(privateKeyPath, 'utf8');
  const result = await prepareMacProvisioningProfile({
    keyId: process.env.APPLE_API_KEY_ID,
    issuerId: process.env.APPLE_API_ISSUER,
    privateKey,
    certificateSerial: process.env.APPLE_SIGNING_CERTIFICATE_SERIAL,
    outputPath: outputArgument(process.argv.slice(2))
  });
  process.stdout.write(`Developer ID provisioning profile ${result.disposition}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
