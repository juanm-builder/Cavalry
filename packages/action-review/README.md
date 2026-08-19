# @cavalry/action-review

Review and safety workflows for proposed workbook changes. This package owns action-plan parsing, draft lifecycle and conflict handling, checkpoints, approval gates, and rollback logic.

## Boundary

`action-review` may depend on `@cavalry/finance-core`. It must not import Advisor orchestration, desktop host, renderer, server, or Companion API modules. Provider-specific draft interpretation and Advisor-facing display models belong in `@cavalry/advisor`.

Public modules are available through the package root and the explicit `application/*` and `domain/*` export-map entries. Prefer package specifiers across workspace boundaries:

```js
import { normalizeAiDraft } from '@cavalry/action-review';
import { applyDraftGroup } from '@cavalry/action-review/application/drafts/draft-apply-service.js';
```

The package mutates workbooks only in its existing apply, reject, checkpoint, and rollback services. Draft normalization and projections remain deterministic.

Pure domain and application coverage lives under `tests/` and runs with `npm test --workspace @cavalry/action-review`.
