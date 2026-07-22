# Companion API Power-User Beta Privacy

Path A uses a local Cavalry API, a temporary public tunnel, and a Custom GPT Action. Treat this as a deliberate beta test, not normal production use.

## What Data Can Leave The Machine

- Data sent from Cavalry API responses to the Custom GPT, such as workbook summaries, account/category lists, recent transaction snippets, draft group IDs, and review URLs.
- Request data sent by ChatGPT to Cavalry through the tunnel, such as transaction draft descriptions, amounts, account/category hints, and notes.
- Any data included in the Custom GPT conversation.
- Any data exposed over the tunnel if the public URL and beta token leak while the server is running.

## What Does Not Happen Automatically

- No automatic upload of the full workbook.
- No direct apply.
- No direct delete.
- No direct archive/post/final mutation.
- No workbook mutation before Cavalry-side review approval.

## Recommended Beta Practices

- Use a test workbook first.
- Keep recent transaction limits small.
- Rotate the token after each test.
- Stop the tunnel after each test.
- Avoid real financial data until comfortable.
- Inspect API responses.
- Inspect audit logs with `npm run audit:recent --workspace @cavalry/companion-api`.
- Run `npm run disable --workspace @cavalry/companion-api` when finished.

## Why Path B Later Needs OAuth And Cloud

Path B should remove the tunnel burden and add real hosted HTTPS, OAuth, per-user auth, token revocation, durable audit/idempotency/rate-limit stores, production monitoring, privacy/legal review, and a user account/workbook sync model.
