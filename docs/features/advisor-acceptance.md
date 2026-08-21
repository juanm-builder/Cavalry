# Advisor acceptance and safety

Advisor and the in-app Companion are optional and must degrade safely. Read-only questions may return
verified workbook calculations. Write-like requests can never apply workbook mutations directly from
model output. Advisor draft operations cross the checkpoint review pipeline. In-app Companion writes
cross a Cavalry-owned capability, entity-resolution, declared confirmation policy, feature command,
durable persistence, and receipt boundary; a capability whose policy is `none` does not show a
confirmation prompt.

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
- Provider stream deltas are request-scoped transient UI only; they are never saved as transcript
  messages.
- A completed turn persists at most one coherent public assistant message. Tool-call preambles,
  protocol frames, raw arguments, status messages, and internal activities are not public transcript
  content.
- Cancellation, failure, and retry clear transient output and do not leave a fabricated completion
  message.
- Feature-owned capability manifests are the source of truth for input/output schemas, entity
  requirements, access, confirmation, availability, deprecation, versioning, validation, handlers,
  and result presentation.
- Explicit account, card, transaction, and budget names resolve to stable application IDs. Ambiguous
  matches require clarification and are never chosen by ordering.
- Application-owned structured results and receipts are authoritative for requested, proposed,
  awaiting-confirmation, attempted, completed, cancelled, failed, and rolled-back states.
- A workbook mutation is described as completed only after durable persistence succeeds. A save
  failure leaves the prior workbook current; a committed result that cannot be fully verified is
  described as saved but needing review.
- Replacement, correction, and move operations are atomic and idempotent at their declared operation
  boundary. Failure keeps or restores the original, and replay cannot create a duplicate change.
- Advisor write-like outcomes enter the `action-review` draft/checkpoint pipeline. Applying one of
  those drafts requires its existing explicit approval path, and rejection leaves transactions,
  accounts, categories, budgets, and recurring items unchanged.
- In-app Companion writes use the feature capability's declared `none`, `conditional`, or `always`
  confirmation policy and then cross the normal feature command and durable commit boundary. They
  do not implicitly become `action-review` drafts.
- Configured-provider failure returns a safe verified fallback when available.
- Provider secrets remain in privileged adapters and are scrubbed from renderer responses.
- Source references, workbook facts, and candidate IDs are grounded before model suggestions are presented.
- Existing manual expected-income budgets remain unchanged unless the user explicitly targets them.
- Existing reimbursement semantics remain unchanged: reimbursements retain their established income
  treatment and warning unless recorded as merchant refunds.

## Local memory acceptance

Companion personalization is stored in the transparent local `memory.md` file, outside the workbook
and saved chats. Acceptance requires all of the following:

- A new memory file starts disabled and is not silently populated from ordinary conversation.
- Settings show the file path and expose separate open-file, open-folder, and reload controls.
- Users can create, update, and delete individual records, clear all memory after confirmation, and
  enable or disable its use.
- Explicit remember, update, and forget requests from chat use the same record operations and require
  the separate approved-chat-updates preference.
- Every write is atomic, serialized, and revision-checked. An external edit causes a conflict instead
  of being overwritten, and reloading exposes the latest file revision.
- External edits are discovered before the next model request and while the settings view refreshes.
- Only a bounded, relevance-selected subset is added to a request. It is labeled as untrusted
  background context, cannot authorize an action, and is never treated as current workbook evidence.
- With a remote or custom network provider, the selected memory context is disclosed as data sent to
  that endpoint. Disabling memory prevents its inclusion.

## Focused Companion scenarios

Before release, cover the following with automated tests and the native UI checklist:

1. A streaming answer that invokes a tool shows transient text while working and ends with one clean
   final assistant message.
2. A stale request delta, cancellation, transport error, tool error, confirmation decline, and retry
   leave no partial or duplicated transcript message.
3. Ambiguous aliases produce clarification candidates with stable IDs; confirmation replays the same
   canonical proposal.
4. Successful, failed, rolled-back, saved-but-unverified, and persistence-failed writes produce copy
   that agrees with their structured receipt.
5. Replacement/correction failure and idempotent retry preserve the original ledger state and do not
   duplicate the replacement.
6. Memory record CRUD, clear, external-edit refresh, revision conflict, relevance selection, and chat
   remember/forget behave identically through their shared host boundary.

Production Advisor semantics and orchestration live in `packages/advisor/`; its draft lifecycle,
checkpoints, conflict detection, approval, and rollback live in `packages/action-review/`. The
in-app Companion capability confirmation and durable-commit path is application-owned and separate
from that checkpoint pipeline. Desktop host transport, model process lifecycle, and local memory
persistence live in `apps/desktop/src/host/`. The renderer owns transient streaming, final transcript
persistence, and application-owned action receipt presentation.

See [AI Companion capabilities](ai-companion-capabilities.md) and
[Companion trust architecture](companion-trust-architecture.md) for the concrete contracts.
