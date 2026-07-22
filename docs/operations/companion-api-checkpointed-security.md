# Companion API Checkpointed Security

Checkpointed apply means an external AI can ask Cavalry to apply supported workbook changes, but only inside a Cavalry-controlled checkpoint.

It is more powerful than drafts because workbook data can change automatically. That is why it is off by default, requires explicit mode, requires a stronger scope, and remains power-user beta only.

## What A Checkpoint Stores

A checkpoint stores actor/origin, request ID, idempotency key status, source prompt when safe, before/after workbook fingerprints, before/after entity values needed for review and rollback, validation issues, warnings, and audit event IDs.

It must not store API tokens, Authorization headers, raw secrets, or tunnel tokens.

## Rollback Limits

Rollback can undo supported workbook edits when the current entity still matches the checkpoint after-state. If the user edited the same entity afterward, Cavalry reports a conflict instead of silently overwriting newer work.

Checkpointing can undo workbook edits, but it cannot undo financial data already sent to an external service or leaked through a tunnel/token. Users must use test workbooks first.

## Blocked Actions

Cavalry blocks permanent delete, delete-all, clear checkpoint history, disable checkpoints, change API/auth settings, connect bank, send money, make payments, tax/legal filing, investment trading, and raw mutation endpoint requests.

## Tunnel Privacy

During Path A/Beta, data can flow through ChatGPT and the temporary tunnel. Stop the tunnel, disable checkpointed mode, and rotate tokens after testing.

## Production Requirements

Production cloud requires hosted HTTPS, OAuth, per-user auth, durable checkpoint/idempotency/audit/rate-limit stores, token revocation, monitoring, support procedures, privacy/legal review, and a user account/workbook sync model.
