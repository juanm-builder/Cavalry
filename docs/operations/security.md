# Security and data handling

Report suspected vulnerabilities privately through the process in [`SECURITY.md`](../../SECURITY.md). Never attach real financial records, credentials, signing material, private tunnel URLs, or model files to a public issue.

## Desktop trust boundaries

- The renderer has no Node integration.
- Tauri capabilities do not grant shell or process execution to the renderer.
- The renderer reaches privileged host behavior through one named Rust command.
- Rust accepts only approved `cavalry-*` channel prefixes, enforces request limits and timeouts, and launches only the named sidecar.
- Native dialogs and external URLs are constrained by the renderer broker and Tauri permissions.
- External write proposals remain draft-first and require explicit review.

## Credential storage

The host encrypts credentials with AES-256-GCM using a random master key protected by:

- macOS Login Keychain; or
- Windows current-user DPAPI.

A local key file is allowed only in development or under an explicit development override. Packaged builds fail closed when secure OS storage is unavailable. Old Electron `safeStorage` ciphertext is treated as incompatible rather than copied or written in plaintext.

## Content security

The renderer Content Security Policy blocks embedded frames, objects, unsafe evaluation, and unapproved network destinations. Cloud connections are restricted to configured Supabase origins; local model sockets are limited to localhost.

## Release security

Before publishing:

```bash
npm run release:security
npm run verify:architecture
```

Review the generated Tauri capability set, updater public key and endpoint, target-specific sidecar, OS signatures, repository diff, and secret scan. Rotate any exposed credential even if it was deleted later.
