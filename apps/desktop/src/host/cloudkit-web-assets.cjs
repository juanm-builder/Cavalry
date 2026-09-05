'use strict';

const { MAX_PAYLOAD_BYTES, fail, payloadBytes, sha256 } = require('./cloudkit-web-records.cjs');
const ASSET_DOMAINS = ['icloud-content.com', 'icloud.com', 'apple-cloudkit.com'];

function assetUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail('cloud_asset_url_invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !ASSET_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  ) {
    throw fail('cloud_asset_url_invalid');
  }
  return url;
}

async function readBounded(response, maximum) {
  const length = response.headers.get('content-length');
  if (length != null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel();
    throw fail('cloud_quota_exceeded');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw fail();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw fail('cloud_quota_exceeded');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function createAssetTransport(fetchImpl) {
  async function transfer(rawUrl, options = {}, maximum = MAX_PAYLOAD_BYTES) {
    let url = assetUrl(rawUrl);
    const signal = AbortSignal.timeout(60_000);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetchImpl(url.href, {
        ...options,
        redirect: 'manual',
        credentials: 'omit',
        signal,
        headers: options.method === 'POST' ? { 'content-type': 'application/octet-stream' } : {}
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (options.method === 'POST' && ![307, 308].includes(response.status))
          throw fail('cloud_asset_upload_failed');
        const location = response.headers.get('location');
        if (!location) throw fail('cloud_asset_url_invalid');
        url = assetUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw fail('cloud_asset_request_failed');
      }
      return readBounded(response, maximum);
    }
    throw fail('cloud_asset_url_invalid');
  }

  async function download(asset, hash) {
    if (
      !asset ||
      !/^[a-f0-9]{64}$/.test(hash || '') ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > MAX_PAYLOAD_BYTES
    )
      throw fail();
    const data = await transfer(asset.downloadURL);
    if (data.length !== asset.size || sha256(data) !== hash) throw fail();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw fail();
    }
  }

  async function upload(url, html) {
    const data = payloadBytes(html);
    const response = await transfer(url, { method: 'POST', body: data }, 64 * 1024);
    let asset;
    try {
      asset = JSON.parse(response.toString('utf8')).singleFile;
    } catch {
      throw fail();
    }
    if (
      !asset ||
      asset.size !== data.length ||
      !['fileChecksum', 'referenceChecksum', 'wrappingKey', 'receipt'].every(
        (key) =>
          typeof asset[key] === 'string' && asset[key].length > 0 && asset[key].length <= 16384
      )
    )
      throw fail();
    return { asset, hash: sha256(data) };
  }

  return { download, upload };
}

module.exports = { createAssetTransport, assetUrl };
