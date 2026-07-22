#!/usr/bin/env sh
set -eu

curl -sS \
  -H "Authorization: Bearer <YOUR_BETA_API_KEY>" \
  "<YOUR_PUBLIC_BASE_URL>/v1/workbooks/<WORKBOOK_ID>/summary?start_date=2026-06-01&end_date=2026-06-30"
