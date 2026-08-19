# Companion API Power-User Beta

This is a power-user beta. It proves that a Custom GPT can call a local Cavalry app through a temporary HTTPS tunnel and create reviewable drafts.

It is not production cloud. Cavalry Cloud, OAuth, durable audit stores, durable idempotency/rate limits, monitoring, and production security review are Path B work.

## What A Tunnel Is

ChatGPT cannot call `localhost` on your Mac. A tunnel gives your local Companion API a temporary public HTTPS URL so a Custom GPT Action can reach it during testing.

Only run a tunnel while actively testing. Anyone with the URL and token can reach the beta API while it is running.

## Safety Model

- The API is off by default.
- Beta tunnel mode requires explicit opt-in.
- Beta tunnel mode requires a beta token.
- GPT-facing endpoints can create reviewable drafts only.
- No GPT-facing endpoint can apply, delete, archive, post, or directly mutate workbook data.
- Use a test workbook first.
- Stop the tunnel when you are done.

## Setup Flow

For live app testing, start the Cavalry Tauri app with the Companion API environment. The standalone `companion:serve:beta` command is useful for certification, but it does not see the workbook currently open in the app UI.

```sh
npm run beta:doctor --workspace @cavalry/companion-api
npm run token --workspace @cavalry/companion-api

export CAVALRY_COMPANION_API_ENABLED=1
export CAVALRY_COMPANION_API_MODE=beta_tunnel
export CAVALRY_COMPANION_BETA_API_KEY="..."
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://your-public-tunnel.example.com"

npm run dev
npm run beta:openapi --workspace @cavalry/companion-api
npm run beta:bundle --workspace @cavalry/companion-api
npm run beta:certify --workspace @cavalry/companion-api
```

With the app running, `/v1/workbooks` returns the workbook open in Cavalry, and draft creation writes to the same AI Drafts/review UI used by manual review.

The beta token is like a temporary key to your Cavalry draft API. Treat it like a password. If it leaks, disable the API and rotate the token.

## ngrok Example

```sh
ngrok http 127.0.0.1:<PORT>
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://....ngrok-free.app"
```

## Cloudflare Tunnel Example

```sh
cloudflared tunnel --url http://127.0.0.1:<PORT>
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://....trycloudflare.com"
```

## Generic Tunnel

```sh
export CAVALRY_COMPANION_PUBLIC_BASE_URL="https://your-public-tunnel.example.com"
```

## Disable After Testing

```sh
npm run disable --workspace @cavalry/companion-api

unset CAVALRY_COMPANION_API_ENABLED
unset CAVALRY_COMPANION_API_MODE
unset CAVALRY_COMPANION_BETA_API_KEY
unset CAVALRY_COMPANION_BETA_API_KEY_HASH
unset CAVALRY_COMPANION_PUBLIC_BASE_URL
```

Stop the Companion API process and stop the tunnel process too.

## In-App Panel Status

The current Path A implementation provides CLI/status reports instead of a full in-app Companion API Beta panel:

- `npm run status --workspace @cavalry/companion-api`
- `npm run beta:doctor --workspace @cavalry/companion-api`
- `npm run beta:certify --workspace @cavalry/companion-api`
- `npm run audit:recent --workspace @cavalry/companion-api`

A dedicated settings panel is a future UI improvement.
