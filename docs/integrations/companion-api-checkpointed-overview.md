# Companion API Checkpointed Overview

Checkpointed AI actions are a power-user beta layer above the draft-first Companion API.

Draft-first mode still works:

```text
ChatGPT -> draft group -> Cavalry review UI -> user applies
```

Checkpointed apply mode is explicit and stronger:

```text
ChatGPT -> checkpointed executor -> reversible workbook changes -> checkpoint review -> user can undo
```

Checkpointed apply is off by default. It requires:

- Companion API enabled explicitly.
- `CAVALRY_COMPANION_AI_ACTION_MODE=checkpointed_apply`.
- `CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1`.
- `cavalry.ai.checkpoint.execute` scope.
- A bounded action plan.
- A checkpoint record for every mutation.

Supported first beta actions include reversible transaction create/update/archive/restore, recurring item create/update/archive/restore, category assignment/create/rename, and budget create/update/archive. Bill/payment/bank/permanent-delete actions remain blocked unless a reversible domain path exists.

Production cloud ready: false.
