# Security

Do not report a suspected vulnerability in a public issue. Use the repository's private security-advisory channel when available, or contact the maintainers privately. Include affected versions, reproduction steps, impact, and any proposed mitigation without attaching real financial data or credentials.

Never commit API keys, bearer tokens, OAuth credentials, private tunnel URLs, user workbooks, backups, local application data, logs containing financial data, or model files. Keep secrets in ignored local configuration or the operating system's supported secret storage.

The renderer must not gain direct Node or Electron access. Keep `contextIsolation` enabled, expose only narrow preload methods, validate all IPC inputs, and keep external actions draft-first with explicit review. Security-sensitive fixes should include regression coverage and a private disclosure timeline before public release notes.
