import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAssetTransport } = require('../../src/host/cloudkit-web-assets.cjs');
const { cloudKitFailure } = require('../../src/host/cloudkit-web-library.cjs');
const { sha256 } = require('../../src/host/cloudkit-web-records.cjs');

const HTML = '<html>sample\n€</html>';
const URL = 'https://p1.icloud-content.com/asset?signature=private-secret';
const asset = { downloadURL: URL, size: Buffer.byteLength(HTML) };

async function attempt(transport, operation) {
  return operation === 'upload'
    ? transport.upload(URL, HTML)
    : transport.download(asset, sha256(HTML));
}

describe('CloudKit asset transport failure diagnostics', () => {
  it.each(['upload', 'download'])(
    'keeps %s network and timeout failures retryable without signed URLs',
    async (operation) => {
      for (const failure of [
        new TypeError(`fetch failed ${URL}`),
        new DOMException(URL, 'TimeoutError')
      ]) {
        const transport = createAssetTransport(async () => {
          throw failure;
        });
        const error = await attempt(transport, operation).catch((value) => value);
        expect(error).toMatchObject({
          code: 'cloud_asset_request_failed',
          cloudkitOperation: `assets/${operation}`
        });
        expect(error).not.toHaveProperty('httpStatus');
        const result = cloudKitFailure(error, {
          operation: operation === 'upload' ? 'save' : 'download',
          workbookId: 'sample-book'
        });
        expect(result).toMatchObject({
          ok: false,
          code: 'cloud_asset_request_failed',
          retryable: true,
          errorDetails: `Request: assets/${operation}.`,
          errorWorkbookId: 'sample-book'
        });
        expect(`${error.message} ${JSON.stringify(error)} ${JSON.stringify(result)}`).not.toContain(
          'private-secret'
        );
      }
    }
  );

  it.each(['upload', 'download'])(
    'preserves the %s stage and status for interrupted response streams',
    async (operation) => {
      const transport = createAssetTransport(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(Buffer.from('partial'));
              },
              pull(controller) {
                controller.error(new Error(`stream interrupted ${URL}`));
              }
            }),
            { status: 200 }
          )
      );
      const error = await attempt(transport, operation).catch((value) => value);
      expect(error).toMatchObject({
        code: 'cloud_asset_request_failed',
        cloudkitOperation: `assets/${operation}`,
        httpStatus: 200
      });
      expect(cloudKitFailure(error)).toMatchObject({
        retryable: true,
        errorDetails: `Request: assets/${operation}. HTTP status: 200.`
      });
      expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('private-secret');
    }
  );

  it('preserves an HTTP failure status without reading or exposing the response body', async () => {
    const cancel = vi.fn();
    const transport = createAssetTransport(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from('private-secret'));
            },
            cancel
          }),
          { status: 503 }
        )
    );
    const error = await transport.upload(URL, HTML).catch((value) => value);
    expect(error).toMatchObject({
      code: 'cloud_asset_request_failed',
      cloudkitOperation: 'assets/upload',
      httpStatus: 503
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(cloudKitFailure(error))).not.toContain('private-secret');
  });

  it('does not reclassify untrusted redirect destinations as retryable network failures', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://untrusted.example/private-secret' }
        })
    );
    const error = await createAssetTransport(fetch)
      .upload(URL, HTML)
      .catch((value) => value);
    expect(error).toMatchObject({
      code: 'cloud_asset_url_invalid',
      cloudkitOperation: 'assets/upload',
      httpStatus: 307
    });
    expect(cloudKitFailure(error).retryable).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain('private-secret');
  });

  it('does not report a prior redirect status as the status of a later network failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/next' } }))
      .mockRejectedValueOnce(new TypeError(URL));
    const error = await createAssetTransport(fetch)
      .upload(URL, HTML)
      .catch((value) => value);
    expect(error.code).toBe('cloud_asset_request_failed');
    expect(error).not.toHaveProperty('httpStatus');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
