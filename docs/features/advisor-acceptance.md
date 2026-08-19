# Advisor acceptance and safety

Advisor is optional and must degrade safely. Read-only questions may return verified workbook calculations; write-like requests must produce reviewable drafts and can never apply workbook mutations directly from model output.

## Required checks

```bash
npm test --workspace @cavalry/advisor
npm test --workspace @cavalry/action-review
npm run advisor:certify --workspace @cavalry/desktop
npm run check
```

`advisor:certify` launches the Tauri UI with controlled transport fixtures and exercises the visible conversation, draft review, apply, and reject paths. It writes ignored evidence under `apps/desktop/test-artifacts/advisor-ui-certification/`.

Live provider certification is opt-in:

```bash
npm run advisor:live-smoke --workspace @cavalry/desktop
```

Remote calls require an explicit API key/model; local-model calls require an explicit endpoint/model or opt-in flag. Normal CI must not require either provider.

## Invariants

- Model output is untrusted input, never a mutation command.
- Write-like outcomes enter the draft/checkpoint review pipeline.
- Applying a draft requires an existing explicit approval path.
- Rejection leaves transactions, accounts, categories, budgets, and recurring items unchanged.
- Configured-provider failure returns a safe verified fallback when available.
- Provider secrets remain in privileged adapters and are scrubbed from renderer responses.
- Source references, workbook facts, and candidate IDs are grounded before model suggestions are presented.

Production semantics and orchestration live in `packages/advisor/`; draft lifecycle, checkpoints, conflict detection, approval, and rollback live in `packages/action-review/`. Desktop-host transport and local-process lifecycle live in `apps/desktop/src/host/`.
