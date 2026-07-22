#!/usr/bin/env sh
set -eu

curl -sS -X POST \
  -H "Authorization: Bearer <YOUR_BETA_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <UNIQUE_IDEMPOTENCY_KEY>" \
  -d @create-transaction-drafts.json \
  "<YOUR_PUBLIC_BASE_URL>/v1/workbooks/<WORKBOOK_ID>/drafts/transaction-batch"
