# Public repository publication

This checklist covers publishing the sanitized Cavalry source as a new, public repository with one fresh root commit. It supplements the normal [desktop release guide](release.md); it is not a release command.

Do not change the old source repository's visibility and do not push this working clone to the new remote. Its `.git` directory can contain the retired history, tags, stashes, reflogs, and tool-created refs that are intentionally excluded from the public project.

## Build the fresh source snapshot

1. Freeze releases in both retired repositories. Keep them private or archived until the updater transition is complete.
2. Create an empty directory outside this clone. Copy only the existing source files reported by `git ls-files --cached --others --exclude-standard`; never copy `.git`, ignored `.env` files, dependencies, build output, test artifacts, local models, or editor/agent state.
3. Initialize `main` in that directory and configure a GitHub `noreply` commit address if the normal author email should remain private.
4. Run `npm ci`, `npm run release:security -- --content-only`, `npm run check`, `npm run test:integration`, and `npm run test:e2e` in the new directory. The content-only security mode is used here because a history scan requires at least one commit.
5. Review the staged file list, then create one root commit containing the license, third-party notices, contribution policy, security channel, privacy description, current release documentation, and only the intended source files.
6. Run `npm run release:security` against that commit and confirm `git rev-list --count HEAD` reports `1`.
7. Create the empty public GitHub repository and push only `main`. Do not recreate retired tags or releases in the new repository.

Do **not** use `git push --mirror`. A local clone can contain private stashes, tool refs, or other namespaces that should never become remote refs.

## Public GitHub settings

- Keep default workflow permissions read-only and grant write access only to the release job that needs it.
- Require review for signing/release environments and protect the default branch and release tags.
- Require approval for workflows from first-time or fork contributors.
- Enable private vulnerability reporting and verify the link in [SECURITY.md](../../SECURITY.md).
- Enable GitHub code scanning with CodeQL default setup for JavaScript/TypeScript.
- Review Actions retention. Public repositories remove standard hosted-runner minute charges, but artifact storage and larger runners can still incur charges.

## Updater transition

Installed releases must not be stranded on an old update repository. Publish one higher transition version to both the legacy update repository and this repository, with the transition build configured to read future updates from this repository. Verify update metadata and both macOS architectures before retiring the old publication path. Keep the legacy transition assets available for older clients.

After the transition succeeds, publish future releases from the main repository using the scoped GitHub-provided token and revoke the separate update-repository token.

## Final verification

- Clone the public URL into a second clean directory and rerun the documented install and validation commands.
- Confirm `git rev-list --count HEAD` reports `1` before the first public pull request or release.
- Check every Markdown link and inspect repository search results for private paths, credentials, email addresses, and stale internal instructions.
- Download a packaged build and verify project, Electron, Chromium, and third-party notices are present.
- Confirm security reporting is private, release drafts remain invisible to update clients, and artifact retention matches the intended cost.
