# Security policy

## Supported versions

Security fixes target the latest published stable release and the current default branch. Older releases may not receive a backport. If a report affects an older version, include that version so maintainers can determine whether the current release is also affected.

## Report a vulnerability privately

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, screenshot, or log.

Use GitHub's [private vulnerability report form](https://github.com/juanm-builder/Cavalry/security/advisories/new). The repository must have private vulnerability reporting enabled for that form to work. If it is unavailable, do not publish technical details; open a content-free issue asking the repository owner to enable private reporting, or use a private contact method listed on the owner's GitHub profile.

Include:

- the affected Cavalry version, operating system, and architecture;
- the component and configuration involved;
- minimal reproduction steps or a proof of concept using synthetic data;
- the expected impact and realistic attack prerequisites; and
- any suggested mitigation.

Do not attach a real workbook, financial data, API key, OAuth token, signing material, tunnel URL, local model, or unredacted diagnostic file. If a live credential has been exposed, revoke or rotate it first and report only the minimum identifying context.

Maintainers will use the private advisory to validate scope, coordinate a fix, and agree on disclosure timing. Please allow a reasonable remediation period before publishing details.

## Important security boundaries

The renderer must remain isolated from Node and Electron, preload APIs must stay narrow, IPC inputs must be validated, and feature code must reach privileged behavior only through injected renderer ports. All external write proposals must remain draft-first with explicit review; model or API output is never a direct workbook mutation command.

Optional Cloud, Advisor, voice, and Companion integrations cross different data boundaries. Review [PRIVACY.md](PRIVACY.md) and the maintained [security and data-handling guide](docs/operations/security.md) before testing them with sensitive information.

## Repository hygiene

Run the documented release security check before publication. Never commit credentials, user workbooks, private keys, signing certificates, environment files with real values, production logs, or generated release artifacts. Treat a deleted or redacted secret as compromised until it has been rotated.
