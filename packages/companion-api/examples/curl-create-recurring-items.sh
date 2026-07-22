#!/usr/bin/env sh
set -eu

curl -sS -X POST \
  -H "Authorization: Bearer <YOUR_BETA_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <UNIQUE_IDEMPOTENCY_KEY>" \
  -d '{"items":[{"name":"ChatGPT Pro","amount":6490,"currency":"PHP","cadence":"monthly","category_hint":"Subscriptions"}]}' \
  "<YOUR_PUBLIC_BASE_URL>/v1/workbooks/<WORKBOOK_ID>/drafts/recurring-items"
