# Advisor Draft View Models

These browser-safe projections turn Advisor transaction and ledger drafts into serializable queue, card, and detail models. They depend on Advisor semantics and therefore live above the generic draft lifecycle in `@cavalry/action-review`.

UI components, DOM access, preload bridges, persistence, and navigation effects do not belong here.
