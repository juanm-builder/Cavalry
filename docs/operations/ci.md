# Continuous integration

## Desktop CI

`.github/workflows/desktop-ci.yml` runs on pull requests and `main`.

The workspace job installs with `npm ci`, refreshes the runtime dependency inventory, runs the repository gates, integration tests, renderer smoke, architecture checks, and whitespace validation.

A separate macOS/Windows matrix runs `cargo check` against the Rust/Tauri host. Keeping this separate makes native compilation failures visible without mixing them with finance or renderer failures.

## Full native build

`.github/workflows/desktop-full.yml` is manual and scheduled. It prepares a target-specific Node sidecar, installs the pinned Tauri CLI, builds the requested Rust target, and uploads native bundle output for:

- macOS Apple Silicon;
- macOS Intel;
- Windows x64.

These artifacts are for certification and do not publish an update.

## Release

`.github/workflows/desktop-release.yml` runs only for `v*` tags. It validates version agreement,
security rules, Cloud build values, tests, and generated notices before entering the credential-bearing
signing environment. The production channel builds macOS Apple Silicon and Intel from the same
immutable tag and uploads a draft release through the pinned Tauri action. Windows remains an
unsigned CI/package target and is not published.

The native matrix is intentionally pinned to architecture-matching hosts and runs one architecture
at a time because both jobs merge into the same draft `latest.json` updater manifest:

| Published target       | GitHub runner    | Required host architecture |
| ---------------------- | ---------------- | -------------------------- |
| `aarch64-apple-darwin` | `macos-15`       | `arm64`                    |
| `x86_64-apple-darwin`  | `macos-15-intel` | `x86_64`                   |

Each job asserts the host architecture, checks that the packaged `cavalry-host` contains the expected
architecture, executes it, and waits for its ready handshake. An architecture mismatch or a sidecar
that cannot execute is a blocking failure; neither target may skip this smoke test.

The release environment supplies operating-system signing material and Tauri updater keys. No private
key is stored in the repository. Both build jobs upload to a draft. A final read-only job then runs
`tools/release/verify-release-assets.mjs` against the GitHub release API and fails unless the draft:

- belongs to the immutable workflow tag and commit;
- contains exactly the two updater archives, their two signatures, two DMGs, and `latest.json`;
- has no missing, duplicate, incomplete, or extra assets;
- declares both macOS updater platforms and matching uploaded signatures; and
- uses same-repository immutable GitHub release asset IDs in updater URLs.

Passing this job does not publish the release. The draft must still pass the complete
[native certification checklist](native-certification.md), and a second reviewer must verify the
exact artifacts and evidence before publication. The `release-signing` environment currently has no
configured non-self reviewer, so this independent sign-off is a manual publication requirement, not
an environment protection enforced by the workflow.

## Security

`.github/workflows/security.yml` runs repository secret, privacy, dependency, and release-configuration checks. Actions are pinned to immutable commits. Workflow permissions default to read-only and are elevated only for the draft-release job.
