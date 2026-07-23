import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createCloudAuthController,
  isPublishableSupabaseKey,
  normalizeCloudConfig,
  OAUTH_ATTEMPT_TTL_MS,
  OAUTH_PENDING_STORAGE_KEY
} = require('../../src/main/cloud-auth-controller.cjs');
const { createTrustedCloudIpcGuard } = require('../../src/main/cloud-ipc-security.cjs');
const { createCloudSessionStorage } = require('../../src/main/cloud-session-storage.cjs');
const {
  createCloudProfileController,
  validateProfileName
} = require('../../src/main/cloud-profile-controller.cjs');
const { createCloudWorkbookController } = require('../../src/main/cloud-workbook-controller.cjs');
const {
  CLOUD_IPC_CHANNELS,
  createCloudController
} = require('../../src/main/cloud-controller.cjs');
const {
  findCavalryDeepLinkArgument,
  getCavalryAuthCallback
} = require('../../src/main/deep-link.cjs');
const {
  createCavalryMainWindow,
  isAllowedRendererNavigation,
  isSafeExternalUrl
} = require('../../src/main/main-window-controller.cjs');

function createEncryptedMemoryFs() {
  const files = new Map();
  const modes = new Map();
  return {
    files,
    modes,
    async readFile(filePath) {
      if (!files.has(filePath)) throw new Error('missing');
      return files.get(filePath);
    },
    async mkdir() {},
    async writeFile(filePath, contents, options) {
      files.set(filePath, String(contents));
      modes.set(filePath, options && options.mode);
    },
    async chmod(filePath, mode) {
      modes.set(filePath, mode);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      modes.set(to, modes.get(from));
      files.delete(from);
      modes.delete(from);
    }
  };
}

function createSecureStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value) => {
      const decoded = value.toString('utf8');
      if (!decoded.startsWith('sealed:')) throw new Error('invalid ciphertext');
      return decoded.slice('sealed:'.length);
    }
  };
}

describe('Cavalry Cloud main-process boundary', () => {
  it('persists Supabase values encrypted and fails closed without a real keychain', async () => {
    const fs = createEncryptedMemoryFs();
    const filePath = '/secure/cavalry-cloud-auth.json';
    const storage = createCloudSessionStorage({ fs, filePath, safeStorage: createSecureStorage() });

    await storage.setItem('sb-auth-token', 'refresh-token-do-not-leak');

    expect(storage.isPersistent()).toBe(true);
    expect(fs.files.get(filePath)).not.toContain('refresh-token-do-not-leak');
    expect(fs.modes.get(filePath)).toBe(0o600);
    await expect(
      createCloudSessionStorage({ fs, filePath, safeStorage: null }).setItem('token', 'plaintext')
    ).rejects.toThrow(/secure operating-system/i);
    expect(
      createCloudSessionStorage({
        fs,
        filePath,
        safeStorage: {
          ...createSecureStorage(),
          getSelectedStorageBackend: () => 'basic_text'
        }
      }).isPersistent()
    ).toBe(false);
  });

  it('waits for one encrypted session load when startup reads overlap', async () => {
    const filePath = '/secure/cavalry-cloud-auth.json';
    const safeStorage = createSecureStorage();
    let finishRead;
    const fs = {
      ...createEncryptedMemoryFs(),
      readFile: vi.fn(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          })
      )
    };
    const storage = createCloudSessionStorage({ fs, filePath, safeStorage });
    const encrypted = safeStorage.encryptString('persisted-session').toString('base64');

    const firstRead = storage.getItem('sb-auth-token');
    const secondRead = storage.getItem('sb-auth-token');
    finishRead(JSON.stringify({ version: 1, values: { 'sb-auth-token': encrypted } }));

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      'persisted-session',
      'persisted-session'
    ]);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('does not touch secure storage on a fresh or signed-out startup', async () => {
    const storedDocuments = [
      null,
      JSON.stringify({
        version: 1,
        encryption: 'electron-safe-storage',
        values: {}
      })
    ];

    for (const storedDocument of storedDocuments) {
      const safeStorage = {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((value) => Buffer.from(`sealed:${value}`, 'utf8')),
        decryptString: vi.fn()
      };
      const readFile = vi.fn(async () => {
        if (storedDocument === null) throw new Error('missing');
        return storedDocument;
      });
      const createStorage = vi.fn();
      const createClient = vi.fn();
      const controller = createCloudAuthController({
        app: { getPath: () => '/secure' },
        safeStorage,
        shell: { openExternal: vi.fn() },
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'sb_publishable_test-key',
        readFile,
        createClient,
        createStorage
      });

      await controller.restoreExistingSession();

      expect(readFile).toHaveBeenCalledWith('/secure/cavalry-cloud-auth.json', 'utf8');
      expect(createStorage).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
      expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({
        status: 'signed_out',
        sessionPersistence: 'pending',
        user: null,
        error: null
      });
    }
  });

  it('restores an existing encrypted session automatically at startup', async () => {
    const user = {
      id: 'returning-user',
      email: 'returning@example.com',
      user_metadata: {},
      app_metadata: { provider: 'google' }
    };
    const safeStorage = {
      ...createSecureStorage(),
      isEncryptionAvailable: vi.fn(() => true)
    };
    const values = new Map([['sb-project-auth-token', 'persisted-session']]);
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: { user } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    };
    const createStorage = vi.fn(() => ({
      isPersistent: () => safeStorage.isEncryptionAvailable(),
      getItem: async (key) => values.get(key) || null,
      setItem: async (key, value) => values.set(key, value),
      removeItem: async (key) => values.delete(key),
      clear: async () => values.clear()
    }));
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage,
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      readFile: vi.fn(async () =>
        JSON.stringify({
          version: 1,
          encryption: 'electron-safe-storage',
          values: { 'sb-project-auth-token': 'encrypted-value' }
        })
      ),
      createClient: vi.fn(() => ({ auth })),
      createStorage
    });

    await controller.restoreExistingSession();

    expect(createStorage).toHaveBeenCalledWith({
      filePath: '/secure/cavalry-cloud-auth.json',
      safeStorage
    });
    expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled();
    expect(auth.getSession).toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: 'signed_in',
      sessionPersistence: 'secure',
      user: { id: 'returning-user' }
    });
  });

  it('initializes secure storage on demand when a fresh user chooses Google sign-in', async () => {
    const safeStorage = {
      ...createSecureStorage(),
      isEncryptionAvailable: vi.fn(() => true)
    };
    const values = new Map();
    const openExternal = vi.fn(async () => {});
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(async () => ({
        data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' },
        error: null
      }))
    };
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage,
      shell: { openExternal },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      readFile: vi.fn(async () => {
        throw new Error('missing');
      }),
      createClient: vi.fn(() => ({ auth })),
      createStorage: () => ({
        isPersistent: () => safeStorage.isEncryptionAvailable(),
        getItem: async (key) => values.get(key) || null,
        setItem: async (key, value) => values.set(key, value),
        removeItem: async (key) => values.delete(key),
        clear: async () => values.clear()
      })
    });

    await controller.restoreExistingSession();
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();

    await expect(controller.signInWithGoogle()).resolves.toMatchObject({ ok: true });
    expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=google'
    );
  });

  it('rejects an unsolicited post-startup auth callback without touching secure storage', async () => {
    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn(),
      decryptString: vi.fn()
    };
    const createStorage = vi.fn(() => ({
      isPersistent: () => true
    }));
    const createClient = vi.fn();
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage,
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      readFile: vi.fn(async () => {
        throw new Error('missing');
      }),
      createClient,
      createStorage
    });

    await controller.restoreExistingSession();
    expect(createStorage).not.toHaveBeenCalled();

    await expect(
      controller.handleAuthCallback({ ok: true, code: 'unexpected-code' })
    ).resolves.toMatchObject({
      ok: false,
      state: {
        status: 'signed_out',
        sessionPersistence: 'pending',
        user: null,
        error: { code: 'oauth_callback_unexpected' }
      }
    });
    expect(createStorage).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('waits for fresh-profile restore before rejecting a callback without secure storage', async () => {
    let finishRead;
    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn(),
      decryptString: vi.fn()
    };
    const createStorage = vi.fn();
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage,
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      readFile: vi.fn(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          })
      ),
      createClient: vi.fn(),
      createStorage
    });

    const restoring = controller.restoreExistingSession();
    const callback = controller.handleAuthCallback({ ok: true, code: 'unexpected-code' });
    finishRead(
      JSON.stringify({
        version: 1,
        encryption: 'electron-safe-storage',
        values: {}
      })
    );

    await expect(restoring).resolves.toMatchObject({ status: 'signed_out' });
    await expect(callback).resolves.toMatchObject({
      ok: false,
      state: {
        status: 'signed_out',
        sessionPersistence: 'pending',
        error: { code: 'oauth_callback_unexpected' }
      }
    });
    expect(createStorage).not.toHaveBeenCalled();
    expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('accepts only strict PKCE callback links and locates cold-start protocol arguments', () => {
    expect(getCavalryAuthCallback('cavalry://auth/callback?code=abc_123-XYZ')).toEqual({
      type: 'auth-callback',
      ok: true,
      code: 'abc_123-XYZ'
    });
    expect(getCavalryAuthCallback('cavalry://auth/callback#access_token=secret')).toBe(null);
    expect(getCavalryAuthCallback('cavalry://auth/callback?code=abc&access_token=secret')).toBe(
      null
    );
    expect(getCavalryAuthCallback('cavalry://auth/callback?code=abc&code=other')).toBe(null);
    expect(getCavalryAuthCallback('cavalry://auth/callback?code=abc&error=denied')).toBe(null);
    expect(getCavalryAuthCallback('https://auth/callback?code=abc')).toBe(null);
    expect(getCavalryAuthCallback('cavalry://evil/callback?code=abc')).toBe(null);
    expect(
      findCavalryDeepLinkArgument(['Cavalry', '--flag', 'cavalry://auth/callback?code=x'])
    ).toBe('cavalry://auth/callback?code=x');
  });

  it('uses a publishable key, system-browser PKCE, and renderer-safe auth state', async () => {
    const user = {
      id: 'user-1',
      email: 'alex@example.com',
      user_metadata: { full_name: 'Alex Example', avatar_url: 'https://example.com/avatar.png' },
      app_metadata: { provider: 'google' }
    };
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(async () => ({
        data: {
          url: 'https://project.supabase.co/auth/v1/authorize?provider=google'
        },
        error: null
      })),
      exchangeCodeForSession: vi.fn(async () => ({
        data: {
          session: { user, access_token: 'access-token-secret', refresh_token: 'refresh-secret' }
        },
        error: null
      })),
      signOut: vi.fn(async () => ({ error: null })),
      stopAutoRefresh: vi.fn()
    };
    const openExternal = vi.fn(async () => {});
    const secureMap = new Map();
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage: createSecureStorage(),
      shell: { openExternal },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      createClient: vi.fn(() => ({ auth })),
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async (key) => secureMap.get(key) || null,
        setItem: async (key, value) => secureMap.set(key, value),
        removeItem: async (key) => secureMap.delete(key),
        clear: async () => secureMap.clear()
      })
    });

    await controller.initialize();
    expect(await controller.signInWithGoogle()).toMatchObject({ ok: true });
    expect(openExternal).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=google'
    );
    const completed = await controller.handleAuthCallback({ ok: true, code: 'one-time-code' });
    expect(completed).toMatchObject({
      ok: true,
      state: {
        status: 'signed_in',
        sessionPersistence: 'secure',
        user: { id: 'user-1', email: 'alex@example.com', name: 'Alex Example' }
      }
    });
    expect(JSON.stringify(completed)).not.toMatch(/access-token-secret|refresh-secret/);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(isPublishableSupabaseKey('sb_secret_forbidden')).toBe(false);
    expect(
      normalizeCloudConfig({
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'sb_secret_forbidden'
      }).configured
    ).toBe(false);
  });

  it('correlates callbacks to an encrypted pending OAuth attempt', async () => {
    const user = {
      id: 'user-1',
      email: 'alex@example.com',
      user_metadata: {},
      app_metadata: { provider: 'google' }
    };
    const exchangeCodeForSession = vi.fn(async () => ({
      data: { session: { user } },
      error: null
    }));
    const clear = vi.fn(async () => {});
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: { user } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      exchangeCodeForSession,
      signOut: vi.fn(async () => ({ error: null }))
    };
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage: createSecureStorage(),
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      createClient: () => ({ auth }),
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        clear
      })
    });

    await controller.initialize();
    const result = await controller.handleAuthCallback({ ok: true, code: 'unsolicited' });

    expect(result).toMatchObject({
      ok: false,
      state: { status: 'signed_in', user: { id: 'user-1' } }
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('accepts a cold-start callback only with its encrypted pending marker', async () => {
    const now = 10_000;
    const user = {
      id: 'user-2',
      email: 'cloud@example.com',
      user_metadata: {},
      app_metadata: { provider: 'google' }
    };
    const createController = (includeMarker) => {
      const values = new Map(
        includeMarker ? [[OAUTH_PENDING_STORAGE_KEY, String(now + OAUTH_ATTEMPT_TTL_MS)]] : []
      );
      const exchangeCodeForSession = vi.fn(async () => ({
        data: { session: { user } },
        error: null
      }));
      const auth = {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        exchangeCodeForSession,
        signOut: vi.fn(async () => ({ error: null }))
      };
      const createStorage = vi.fn(() => ({
        isPersistent: () => true,
        getItem: async (key) => values.get(key) || null,
        setItem: async (key, value) => values.set(key, value),
        removeItem: async (key) => values.delete(key),
        clear: async () => values.clear()
      }));
      return {
        controller: createCloudAuthController({
          app: { getPath: () => '/secure' },
          safeStorage: createSecureStorage(),
          shell: { openExternal: vi.fn() },
          supabaseUrl: 'https://project.supabase.co',
          publishableKey: 'sb_publishable_test-key',
          now: () => now,
          readFile: vi.fn(async () =>
            JSON.stringify({
              version: 1,
              encryption: 'electron-safe-storage',
              values: includeMarker ? { [OAUTH_PENDING_STORAGE_KEY]: 'encrypted-marker' } : {}
            })
          ),
          createClient: () => ({ auth }),
          createStorage
        }),
        createStorage,
        exchangeCodeForSession
      };
    };
    const matched = createController(true);
    const unmatched = createController(false);

    expect(
      await matched.controller.handleAuthCallback({ ok: true, code: 'matched' })
    ).toMatchObject({
      ok: true,
      pending: true
    });
    await matched.controller.restoreExistingSession();
    expect(matched.controller.getState()).toMatchObject({ status: 'signed_in' });
    expect(matched.createStorage).toHaveBeenCalledTimes(1);
    expect(matched.exchangeCodeForSession).toHaveBeenCalledWith('matched');

    await unmatched.controller.handleAuthCallback({ ok: true, code: 'unmatched' });
    await unmatched.controller.restoreExistingSession();
    expect(unmatched.controller.getState()).toMatchObject({
      status: 'signed_out',
      error: { code: 'oauth_callback_unexpected' }
    });
    expect(unmatched.createStorage).not.toHaveBeenCalled();
    expect(unmatched.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('fails sign-out closed when encrypted session removal fails', async () => {
    const user = {
      id: 'user-3',
      email: 'secure@example.com',
      user_metadata: {},
      app_metadata: { provider: 'google' }
    };
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: { user } }, error: null })),
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => ({ error: null }))
    };
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage: createSecureStorage(),
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      createClient: () => ({ auth }),
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        clear: async () => {
          throw new Error('disk failure');
        }
      })
    });

    await controller.initialize();
    const result = await controller.signOut();

    expect(result).toMatchObject({
      ok: false,
      state: {
        status: 'error',
        user: { id: 'user-3' },
        error: { code: 'secure_sign_out_failed' }
      }
    });
  });

  it('expires an abandoned browser sign-in and clears its secure state', async () => {
    let currentTime = 20_000;
    let timeoutCallback = null;
    const values = new Map();
    const clear = vi.fn(async () => values.clear());
    const auth = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(async () => ({
        data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' },
        error: null
      })),
      signOut: vi.fn(async () => ({ error: null }))
    };
    const controller = createCloudAuthController({
      app: { getPath: () => '/secure' },
      safeStorage: createSecureStorage(),
      shell: { openExternal: vi.fn(async () => {}) },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      now: () => currentTime,
      setTimeout: (callback) => {
        timeoutCallback = callback;
        return { unref() {} };
      },
      clearTimeout: () => {},
      createClient: () => ({ auth }),
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async (key) => values.get(key) || null,
        setItem: async (key, value) => values.set(key, value),
        removeItem: async (key) => values.delete(key),
        clear
      })
    });

    await controller.initialize();
    await controller.signInWithGoogle();
    expect(controller.getState().status).toBe('signing_in');
    expect(values.has(OAUTH_PENDING_STORAGE_KEY)).toBe(true);

    currentTime += OAUTH_ATTEMPT_TTL_MS;
    timeoutCallback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clear).toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      status: 'signed_out',
      error: { code: 'oauth_timeout' }
    });
  });

  it('uses the exact snapshot RPC contract and returns decoded workbooks without raw rows', async () => {
    const calls = [];
    const workbook = {
      id: 'workbook_local_1',
      name: 'Personal 2026',
      year: 2026,
      currency: 'PHP',
      version: 2,
      updatedAt: '2026-07-20T04:00:00.000Z'
    };
    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            order: async () => ({ data: [], error: null })
          })
        })
      }),
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'save_workbook_snapshot') {
          return {
            data: [
              {
                local_workbook_id: workbook.id,
                name: workbook.name,
                year: workbook.year,
                currency: workbook.currency,
                latest_revision: 1,
                updated_at: workbook.updatedAt
              }
            ],
            error: null
          };
        }
        if (name === 'download_workbook_snapshot') {
          return {
            data: [
              {
                local_workbook_id: workbook.id,
                name: workbook.name,
                year: workbook.year,
                currency: workbook.currency,
                latest_revision: 1,
                updated_at: workbook.updatedAt,
                portable_html: '<html>portable</html>'
              }
            ],
            error: null
          };
        }
        return { data: true, error: null };
      }
    };
    const controller = createCloudWorkbookController({
      auth: { isSignedIn: () => true, getClient: () => client },
      getPersistenceService: async () => ({
        deserializeWorkbookFromFile: () => ({ workbook }),
        serializeWorkbookForSave: () => ({ html: '<html>portable</html>' })
      })
    });

    expect(await controller.uploadWorkbook({ workbook, expectedRevision: null })).toMatchObject({
      ok: true,
      metadata: { id: 'workbook_local_1', revision: 1 }
    });
    expect(calls[0]).toEqual({
      name: 'save_workbook_snapshot',
      args: {
        p_local_workbook_id: 'workbook_local_1',
        p_name: 'Personal 2026',
        p_year: 2026,
        p_currency: 'PHP',
        p_schema_version: 2,
        p_portable_html: '<html>portable</html>',
        p_expected_revision: null,
        p_device_id: null,
        p_source_updated_at: '2026-07-20T04:00:00.000Z'
      }
    });
    const downloaded = await controller.downloadWorkbook({ workbookId: workbook.id });
    expect(downloaded).toMatchObject({ ok: true, workbook, metadata: { revision: 1 } });
    expect(downloaded).not.toHaveProperty('portableHtml');
    expect(await controller.deleteWorkbook({ workbookId: workbook.id })).toEqual({
      ok: true,
      id: workbook.id
    });
  });

  it('rejects workbook IDs that the database contract cannot store', async () => {
    const rpc = vi.fn();
    const controller = createCloudWorkbookController({
      auth: {
        isSignedIn: () => true,
        getClient: () => ({ rpc })
      },
      getPersistenceService: async () => ({
        serializeWorkbookForSave: () => ({ html: '<html>portable</html>' }),
        deserializeWorkbookFromFile: () => ({
          workbook: {
            id: 'My Workbook',
            name: 'Invalid ID',
            year: 2026,
            currency: 'PHP',
            version: 2
          }
        })
      })
    });

    await expect(
      controller.uploadWorkbook({
        workbook: {
          id: 'My Workbook',
          name: 'Invalid ID',
          year: 2026,
          currency: 'PHP',
          version: 2
        }
      })
    ).resolves.toMatchObject({ ok: false, code: 'invalid_workbook_id' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a database migration mismatch instead of masking it as a secure upload failure', async () => {
    const workbook = {
      id: 'workbook-1',
      name: 'Cloud Plan',
      year: 2026,
      currency: 'PHP',
      version: 2
    };
    const controller = createCloudWorkbookController({
      auth: {
        isSignedIn: () => true,
        getClient: () => ({
          rpc: async () => ({
            data: null,
            error: {
              code: '42702',
              message: 'column reference "local_workbook_id" is ambiguous'
            }
          })
        })
      },
      getPersistenceService: async () => ({
        serializeWorkbookForSave: () => ({ html: '<html>portable</html>' }),
        deserializeWorkbookFromFile: () => ({ workbook })
      })
    });

    await expect(controller.uploadWorkbook({ workbook })).resolves.toEqual({
      ok: false,
      code: 'cloud_database_update_required',
      error: 'Cavalry Cloud needs a database update before this workbook can be uploaded.'
    });
  });

  it('allows cloud IPC only from the exact renderer and prevents in-app remote navigation', () => {
    const frame = { url: 'file:///Applications/Cavalry/index.html', top: null };
    const webContents = {
      mainFrame: frame,
      getURL: () => frame.url,
      isDestroyed: () => false
    };
    const window = { webContents, isDestroyed: () => false };
    const guard = createTrustedCloudIpcGuard({
      getMainWindow: () => window,
      indexPath: '/Applications/Cavalry/index.html'
    });
    expect(guard({ sender: webContents, senderFrame: frame })).toBe(true);
    frame.url = 'https://attacker.example/';
    expect(() => guard({ sender: webContents, senderFrame: frame })).toThrow(/only to Cavalry/);
    expect(
      isAllowedRendererNavigation('file:///Applications/Cavalry/index.html#settings', {
        indexPath: '/Applications/Cavalry/index.html'
      })
    ).toBe(true);
    expect(
      isAllowedRendererNavigation('https://attacker.example', {
        indexPath: '/Applications/Cavalry/index.html'
      })
    ).toBe(false);
    expect(isSafeExternalUrl('https://supabase.com/docs')).toBe(true);
    expect(isSafeExternalUrl('file:///tmp/evil')).toBe(false);

    let willNavigate;
    let windowOpen;
    class BrowserWindow {
      constructor() {
        this.webContents = {
          on: (_name, handler) => {
            willNavigate = handler;
          },
          setWindowOpenHandler: (handler) => {
            windowOpen = handler;
          },
          once: vi.fn()
        };
      }
      once() {}
      loadFile() {}
    }
    const shell = { openExternal: vi.fn(async () => {}) };
    createCavalryMainWindow({
      BrowserWindow,
      indexPath: '/Applications/Cavalry/index.html',
      preloadPath: '/Applications/Cavalry/preload.cjs',
      shell
    });
    const event = { preventDefault: vi.fn() };
    willNavigate(event, 'https://example.com/help');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/help');
    expect(windowOpen({ url: 'https://example.com/help' })).toEqual({ action: 'deny' });
  });

  it('loads and updates only the signed-in owner profile with bounded names', async () => {
    const upsert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { display_name: 'Cavalry Alias' }, error: null })
      })
    }));
    const profileTable = {
      select: () => ({
        eq: (_column, value) => ({
          maybeSingle: async () => ({
            data: { display_name: value === 'user-1' ? 'Cloud Name' : 'Wrong User' },
            error: null
          })
        })
      }),
      upsert
    };
    const auth = {
      getClient: () => ({ from: (table) => (table === 'profiles' ? profileTable : null) }),
      getState: () => ({ user: { id: 'user-1', name: 'Google Name' } }),
      isSignedIn: () => true
    };
    const controller = createCloudProfileController({ auth });

    await expect(controller.getProfile()).resolves.toEqual({
      ok: true,
      profile: { name: 'Cloud Name' }
    });
    await expect(
      controller.updateProfile({ name: '  Cavalry Alias  ', userId: 'attacker-choice' })
    ).resolves.toEqual({ ok: true, profile: { name: 'Cavalry Alias' } });
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', display_name: 'Cavalry Alias' },
      { onConflict: 'user_id' }
    );
    expect(validateProfileName('')).toMatchObject({ ok: false, code: 'profile_name_required' });
    expect(validateProfileName('x'.repeat(81))).toMatchObject({
      ok: false,
      code: 'profile_name_too_long'
    });
  });

  it('hydrates and edits a Cloud profile through trusted renderer-safe IPC', async () => {
    const handlers = new Map();
    const user = {
      id: 'user-profile',
      email: 'cloud@example.com',
      user_metadata: { full_name: 'Google Name' },
      app_metadata: { provider: 'google' }
    };
    const profileUpsert = vi.fn(({ display_name: displayName }) => ({
      select: () => ({
        single: async () => ({ data: { display_name: displayName }, error: null })
      })
    }));
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { user } }, error: null })),
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(async () => ({ error: null }))
      },
      from(table) {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { display_name: 'Existing Cavalry Name' },
                  error: null
                })
              })
            }),
            upsert: profileUpsert
          };
        }
        return {
          select: () => ({
            is: () => ({ order: async () => ({ data: [], error: null }) })
          })
        };
      }
    };
    const controller = createCloudController({
      app: { getPath: () => '/secure' },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      safeStorage: createSecureStorage(),
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      createClient: () => client,
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        clear: async () => {}
      }),
      assertTrustedSender: () => true
    });
    await controller.initialize();
    controller.registerHandlers();

    expect(controller.getState().user).toMatchObject({
      id: 'user-profile',
      name: 'Existing Cavalry Name',
      email: 'cloud@example.com'
    });
    const updated = await handlers.get(CLOUD_IPC_CHANNELS.updateProfile)(
      { senderFrame: {} },
      { name: '  My Edited Name  ', userId: 'another-user' }
    );
    expect(updated).toMatchObject({
      ok: true,
      profile: { name: 'My Edited Name' },
      state: { user: { id: 'user-profile', name: 'My Edited Name' } }
    });
    expect(profileUpsert).toHaveBeenCalledWith(
      { user_id: 'user-profile', display_name: 'My Edited Name' },
      { onConflict: 'user_id' }
    );
    expect(JSON.stringify(updated)).not.toMatch(/access_token|refresh_token/i);
  });

  it('registers the exact cloud IPC surface and returns only renderer-safe state', async () => {
    const handlers = new Map();
    const controller = createCloudController({
      app: { getPath: () => '/secure' },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      safeStorage: null,
      shell: { openExternal: vi.fn() },
      supabaseUrl: '',
      publishableKey: '',
      indexPath: '/Applications/Cavalry/index.html',
      assertTrustedSender: () => true
    });
    await controller.initialize();
    controller.registerHandlers();

    expect([...handlers.keys()].sort()).toEqual(
      Object.entries(CLOUD_IPC_CHANNELS)
        .filter(([name]) => name !== 'stateChanged')
        .map(([, channel]) => channel)
        .sort()
    );
    const result = await handlers.get(CLOUD_IPC_CHANNELS.getState)({ senderFrame: {} }, {});
    expect(result).toMatchObject({
      ok: true,
      state: {
        configured: false,
        status: 'unconfigured',
        sessionPersistence: 'none',
        user: null,
        workbooks: []
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/access_token|refresh_token|provider_token/i);
  });

  it('keeps uploaded workbook metadata coherent when the follow-up list refresh fails', async () => {
    const handlers = new Map();
    const user = {
      id: 'user-4',
      email: 'cloud@example.com',
      user_metadata: {},
      app_metadata: { provider: 'google' }
    };
    let listCount = 0;
    const client = {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { user } }, error: null })),
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn(async () => ({ error: null }))
      },
      from: () => ({
        select: () => ({
          is: () => ({
            order: async () => {
              listCount += 1;
              return listCount === 1
                ? { data: [], error: null }
                : { data: null, error: new Error('offline') };
            }
          })
        })
      }),
      rpc: vi.fn(async () => ({
        data: [
          {
            local_workbook_id: 'workbook-1',
            name: 'Cloud Plan',
            year: 2026,
            currency: 'PHP',
            latest_revision: 1,
            updated_at: '2026-07-20T04:00:00.000Z'
          }
        ],
        error: null
      }))
    };
    const controller = createCloudController({
      app: { getPath: () => '/secure' },
      BrowserWindow: { getAllWindows: () => [] },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      safeStorage: createSecureStorage(),
      shell: { openExternal: vi.fn() },
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test-key',
      createClient: () => client,
      createStorage: () => ({
        isPersistent: () => true,
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        clear: async () => {}
      }),
      getPersistenceService: async () => ({
        deserializeWorkbookFromFile: () => ({
          workbook: {
            id: 'workbook-1',
            name: 'Cloud Plan',
            year: 2026,
            currency: 'PHP',
            version: 2
          }
        })
      }),
      assertTrustedSender: () => true
    });
    await controller.initialize();
    controller.registerHandlers();

    const result = await handlers.get(CLOUD_IPC_CHANNELS.uploadWorkbook)(
      { senderFrame: {} },
      { portableHtml: '<html>portable</html>', expectedRevision: null }
    );

    expect(result).toMatchObject({
      ok: true,
      state: { workbooks: [{ id: 'workbook-1', revision: 1 }] }
    });
  });
});
