import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (filePath) => readFileSync(resolve(filePath), 'utf8');
const json = (filePath) => JSON.parse(read(filePath));

describe('Tauri desktop security boundary', () => {
  it('gives the renderer no direct shell or process capability', () => {
    const capability = json('apps/desktop/src-tauri/capabilities/main.json');
    const permissions = capability.permissions.map((value) =>
      String(typeof value === 'string' ? value : value.identifier)
    );
    expect(permissions).toContain('dialog:default');
    expect(permissions).toContain('updater:default');
    expect(permissions).toContain('opener:allow-open-url');
    const openerScope = capability.permissions.find(
      (value) => typeof value === 'object' && value.identifier === 'opener:allow-open-url'
    );
    expect(openerScope.allow).toEqual([{ url: 'x-apple.systempreferences:*' }]);
    expect(permissions.some((value) => value.startsWith('shell:'))).toBe(false);
    expect(permissions.some((value) => value.startsWith('process:'))).toBe(false);
  });

  it('routes privileged requests through Rust and a named host sidecar', () => {
    const rust = read('apps/desktop/src-tauri/src/lib.rs');
    const broker = read('apps/desktop/src/renderer/platform/tauri-host-broker.js');
    const bundle = json('apps/desktop/src-tauri/tauri.bundle.conf.json');
    expect(rust).toContain('async fn host_invoke');
    expect(rust).toContain('allowed_host_channel');
    expect(broker).toContain("core.invoke('host_invoke'");
    expect(broker).not.toContain('Command.sidecar');
    expect(bundle.bundle.externalBin).toEqual(['binaries/cavalry-host']);
  });

  it('keeps a restrictive webview policy and the Apple bundle identity', () => {
    const config = json('apps/desktop/src-tauri/tauri.conf.json');
    const csp = config.app.security.csp;
    expect(config.app.withGlobalTauri).toBe(true);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(json('apps/desktop/src-tauri/tauri.macos.conf.json').identifier).toBe(
      'com.juanmbuilder.cavalry.mac'
    );
  });
});
