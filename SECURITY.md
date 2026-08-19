# Security policy

## Supported versions

Security fixes target the latest published stable release and the current default branch. Older releases may not receive backports. Include the affected version, operating system, and architecture in a report.

## Report a vulnerability privately

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, screenshot, or log.

Use GitHub's [private vulnerability report form](https://github.com/juanm-builder/Cavalry/security/advisories/new). If private reporting is unavailable, do not publish technical details; ask the repository owner to enable it through a content-free issue or use a private contact method on the owner's GitHub profile.

Include:

- affected version, operating system, and architecture
- component and configuration involved
- minimal reproduction using synthetic data
- realistic impact and attack prerequisites
- suggested mitigation, when available

Do not attach a real workbook, financial data, API key, OAuth token, updater key, signing certificate, tunnel URL, model, or unredacted diagnostic file. Revoke exposed credentials before reporting and include only the minimum identifying context.

## Security boundaries

Cavalry's renderer runs in a Tauri system WebView and must remain isolated from Node, shell, process, Rust internals, and the privileged host. Feature code reaches native behavior only through injected desktop ports. The main capability must not grant shell or process execution.

Rust owns the named sidecar, enforces host-channel prefixes, correlates requests, limits serialized request size, and controls lifecycle. The sidecar protocol must not become a general command-execution mechanism.

All model or external API write proposals remain draft-first with explicit review. They are never direct workbook mutation commands.

Secure credentials use authenticated encryption with an operating-system-protected key. Production must fail closed if secure storage is unavailable. Legacy credential migration must never write plaintext secrets to disk.

Production updates require both a Tauri updater signature and platform-native code signing. macOS also requires notarization and stapling. Tracked configuration must never contain private signing material.

Optional Cloud, Advisor, voice, and Companion integrations cross different data boundaries. Review [PRIVACY.md](PRIVACY.md) and [desktop security](docs/operations/security.md) before testing them with sensitive information.

## Repository hygiene

Run the documented release security check before publication. Never commit credentials, user workbooks, private keys, certificates, `.env` files with real values, production logs, generated sidecars, installers, or update artifacts. Treat a deleted or redacted secret as compromised until it has been rotated.
