#!/usr/bin/env sh
set -eu

curl -sS \
  -H "Authorization: Bearer <YOUR_BETA_API_KEY>" \
  "<YOUR_PUBLIC_BASE_URL>/v1/workbooks"
