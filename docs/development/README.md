# Development

Use Node 22 (see `.node-version`) and run maintained commands from the repository root.

```bash
npm ci
npm run dev
```

The root command facade is:

- `npm run build`
- `npm run format`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run check`
- `npm run package:mac`
- `npm run package:mac:intel`
- `npm run release:validate -- vMAJOR.MINOR.PATCH`

The package commands are local, ad-hoc macOS outputs. Signed and notarized macOS artifacts are built only by the tag-triggered release workflow. Windows packaging remains dormant for a future signed rollout; see [`../operations/release.md`](../operations/release.md).

`npm run check` runs formatting verification, lint, check-JS/type checking, all three Vite builds, unit suites, architecture rules, and Companion contract checks. `npm run test:integration` covers owning-package server/application adapters and Mac integration/Electron modules. `npm run test:e2e` builds and drives the Electron UI.

Run `npm run check` before every handoff. Run integration and E2E gates for workbook persistence, route interactions, preload/IPC, native files, packaging, Advisor transport, or Companion behavior. App- and integration-specific diagnostics remain available with a workspace selector.

## Change workflow

1. Identify the owning app or package from the [architecture map](../architecture/README.md).
2. Add or update the narrowest relevant test before moving behavior across a boundary.
3. Import another workspace only through its package export map; never use a deep relative path across packages.
4. Keep React views serializable and callback-driven. Put preload access in renderer platform adapters and native effects in main-process adapters.
5. Keep pure moves separate from behavior changes when practical.
6. Do not commit generated bundles, package output, test artifacts, local model files, or user workbooks.
7. Update an ADR when a durable boundary or public contract changes.
8. Run the relevant root validation commands and inspect `git diff --check`.

See [contributing.md](contributing.md) for review expectations and [changelog-policy.md](changelog-policy.md) for user-visible change records.
