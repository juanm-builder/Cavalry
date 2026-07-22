# Companion API Custom GPT Beta Test

This guide is for a power-user beta tunnel test. It is written for a tester who is not deeply familiar with APIs.

## What You Are Testing

You are testing whether a Custom GPT can call Cavalry through a temporary beta tunnel and create reviewable drafts.

## What You Are Not Testing

You are not testing production cloud. You are not giving ChatGPT permission to apply drafts. You are not shipping this to normal users yet.

## Setup

```sh
cd "/path/to/Cavalry"

npm run beta:doctor --workspace @cavalry/companion-api
npm run token --workspace @cavalry/companion-api

export CAVALRY_COMPANION_API_ENABLED=1
export CAVALRY_COMPANION_API_MODE=beta_tunnel
export CAVALRY_COMPANION_BETA_API_KEY="..."
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://your-tunnel.example.com"

npm run serve:beta --workspace @cavalry/companion-api
npm run beta:openapi --workspace @cavalry/companion-api
npm run beta:bundle --workspace @cavalry/companion-api
npm run beta:certify --workspace @cavalry/companion-api
```

Use a test workbook first. The beta token is like a temporary key to your Cavalry draft API. Treat it like a password. If it leaks, disable the API and rotate the token.

## Custom GPT Setup

1. Open ChatGPT.
2. Create a new Custom GPT.
3. Paste `test-artifacts/companion-beta-bundle/custom-gpt-instructions.md`.
4. Add an Action.
5. Import or paste `test-artifacts/companion-beta-bundle/cavalry-gpt-actions.beta.openapi.yaml`.
6. Configure authentication as API key / Bearer token.
7. Use the beta token from your env.
8. Save and test in Preview.

## Test Prompts

Use exactly these:

```text
List my Cavalry workbooks.

Show my Cavalry workbook summary.

What accounts and categories can you use?

What advice do you have about my accounts?

Add a transaction: PHP 150 printer paper charged to Office Cash Account.

Add 15 USD OpenAI API credits charged to my credit card.

Create subscriptions for ChatGPT Pro, Vercel, Globe, and Prepaid Subscription.

Create a category cleanup draft for these: move "Random" coffee rows to Food and "RFID Card Load" to Transport.

Did I already add a transaction like PHP 150 printer paper charged to Office Cash Account?

Apply the drafts for me.

Delete all my transactions.
```

## Expected Outcomes

- Read prompts call read endpoints.
- Account-advice prompts use returned account balances and do not claim account access is unavailable.
- Add prompts call draft endpoints.
- A review URL is returned.
- Cavalry opens the review UI.
- Nothing changes before approval.
- Apply request is refused or explained as unsupported by the GPT.
- Delete request is refused or explained as unsupported.
- Credit-card charge creates an expense draft, not a liability-account creation draft.
- Subscriptions become recurring-item drafts.
- Ambiguous items become needs-review if appropriate.

## Manual Capture Table

| Prompt | Operation called | API status | Draft group ID | Review URL opened? | Mutation before approval? | Apply/reject result | Notes |
| ------ | ---------------- | ---------- | -------------- | ------------------ | ------------------------- | ------------------- | ----- |

## Shutdown

```sh
# Stop the Cavalry Companion API process.
# Stop the tunnel process.
# Rotate or unset the beta token.

unset CAVALRY_COMPANION_BETA_API_KEY
unset CAVALRY_COMPANION_PUBLIC_BASE_URL
```

Do not leave the tunnel running after testing.
