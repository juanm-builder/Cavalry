# @cavalry/advisor

Provider-neutral Advisor semantics and orchestration for Cavalry. This package owns prompt interpretation, task planning, financial analysis, safe provider contracts, Advisor draft gates, and Advisor-facing draft display models.

## Boundary

`advisor` builds on `@cavalry/action-review` and `@cavalry/finance-core`. Neither lower-level package may import Advisor code. Electron transports, provider processes, renderer components, Companion APIs, and persistence adapters stay outside this package.

Public modules are available through the package root and the explicit `application/*` and `domain/*` export-map entries:

```js
import { advisorOrchestration } from '@cavalry/advisor';
import { buildAiDraftCardViewModel } from '@cavalry/advisor/application/drafts/draft-card-view-model-service.js';
```

Advisor remains draft-first: proposed mutations pass through the action-review lifecycle and gate before an application adapter persists workbook changes.

Pure domain and orchestration coverage lives under `tests/` and runs with `npm test --workspace @cavalry/advisor`. Renderer, Electron, and provider-process integration tests remain with their owning adapters.
