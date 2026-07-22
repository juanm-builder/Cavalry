# Contributing

Keep changes scoped to one owning boundary and preserve workbook schema version 2, portable HTML/JSON compatibility, ledger semantics, backup behavior, product identity, deep links, and user-data locations unless the change explicitly migrates that contract.

Pull requests should explain the user-visible outcome, changed boundaries, tests run, and known follow-up work. Include fixtures only when they are synthetic and intentionally curated. Do not include local secrets, model weights, real financial data, generated reports, app bundles, or package output.

Prefer package public exports over deep imports. New finance behavior needs deterministic package tests; new renderer behavior needs interaction coverage; native file, preload, or Electron behavior needs adapter or Electron coverage.
