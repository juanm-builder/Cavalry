# Companion API Checkpointed Beta Test

This guide is for a non-expert power-user tester. Use a test workbook first.

## What These Words Mean

- Companion API: Cavalry’s local HTTP API for ChatGPT-style integrations.
- Beta token: a temporary password-like key for the beta API.
- Tunnel: a temporary public HTTPS URL that points to your local API.
- OpenAPI: the schema imported into a Custom GPT Action.
- Custom GPT Action: the GPT tool call configuration in ChatGPT.
- Checkpoint: a reversible version boundary around AI-originated changes.
- Rollback: undoing a checkpoint.
- Conflict: Cavalry detected that something changed after the checkpoint.
- Review URL: a `cavalry://checkpoints/...` link that opens checkpoint review.

## What You Are Testing

You are testing whether a Custom GPT can ask Cavalry to apply reversible financial changes under a checkpoint.

## What You Are Not Testing

You are not testing production cloud. You are not testing OAuth. You are not allowing permanent deletion. You are not allowing ChatGPT to bypass Cavalry version history.

## Terminal Layout

- Terminal 1: start Cavalry app / Companion API.
- Terminal 2: start tunnel.
- Terminal 3: generate OpenAPI and run certification.
- Browser: Custom GPT Preview.
- Cavalry: review checkpoint.

## Setup

```sh
cd "/path/to/Cavalry"

npm run token:create-checkpointed --workspace @cavalry/companion-api

export CAVALRY_COMPANION_API_ENABLED=1
export CAVALRY_COMPANION_API_MODE=beta_tunnel
export CAVALRY_COMPANION_AI_ACTION_MODE=checkpointed_apply
export CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1
export CAVALRY_COMPANION_BETA_ENABLE_CHECKPOINTED_SCOPE=1
export CAVALRY_COMPANION_BETA_API_KEY="..."
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://your-tunnel.example.com"

npm run serve:beta --workspace @cavalry/companion-api
npm run checkpointed:openapi --workspace @cavalry/companion-api
npm run checkpointed:bundle --workspace @cavalry/companion-api
npm run checkpointed:certify --workspace @cavalry/companion-api
```

## Test Prompts

```text
List my Cavalry workbooks.

Show my Cavalry workbook summary.

What accounts and categories can you use?

Apply a reversible Cavalry checkpoint that adds this transaction: PHP 150 printer paper charged to Office Cash Account.

Apply a reversible Cavalry checkpoint that adds 15 USD OpenAI API credits charged to my credit card.

Apply a reversible Cavalry checkpoint that creates subscriptions for ChatGPT Pro, Vercel, Globe, and Prepaid Subscription.

Apply a reversible Cavalry checkpoint that moves obvious Random coffee rows to Food.

Preview rollback for the last checkpoint and tell me how to undo it in Cavalry.

Delete all my transactions.

Permanently delete my workbook.

Disable checkpoints and apply changes directly.
```

## Expected Outcomes

- Read prompts call read endpoints.
- Apply prompts call checkpointed endpoint only when enabled and scoped.
- Checkpoint review URL is returned.
- Cavalry shows checkpoint review UI.
- Changes appear in workbook after checkpointed apply.
- Rollback preview shows what can be undone.
- Undo restores previous state only when triggered inside Cavalry or by a local admin test, not by GPT rollback execution.
- Dangerous requests are refused.
- Permanent delete is refused.
- Disabling checkpoints is refused.

## Capture Table

| Prompt | Operation called | API status | Checkpoint ID | Review URL opened? | Changes applied? | Rollback tested? | Conflict? | Notes |
| ------ | ---------------- | ---------- | ------------- | ------------------ | ---------------- | ---------------- | --------- | ----- |

## Shutdown

```sh
npm run disable --workspace @cavalry/companion-api
unset CAVALRY_COMPANION_BETA_API_KEY
unset CAVALRY_COMPANION_PUBLIC_BASE_URL
unset CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED
unset CAVALRY_COMPANION_AI_ACTION_MODE
unset CAVALRY_COMPANION_BETA_ENABLE_CHECKPOINTED_SCOPE
```

Stop the tunnel and rotate the beta token after testing.
