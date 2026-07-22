# Companion API Beta Release Checklist

## Repo

- Build passes.
- Check passes.
- Unit tests pass.
- API tests pass.
- OpenAPI validation passes.
- GPT Action sanity passes.
- GPT Action certification passes.
- Companion beta doctor passes without failed checks.
- Beta bundle generation passes with a configured public URL.
- Beta certification passes or skips honestly with actionable reason.
- Companion e2e passes.
- Advisor regression tests still pass.

## Security

- Server disabled by default.
- Beta mode explicit.
- Auth required.
- No token logs.
- Localhost-only default.
- Public URL explicit.
- No direct mutation endpoints.
- No GPT-facing apply endpoint.
- Audit logs enabled.
- Idempotency enabled.
- Duplicate detection enabled.

## Product

- Custom GPT instructions generated.
- Beta OpenAPI generated.
- Custom GPT beta bundle generated.
- Power-user beta guide reviewed.
- Privacy guide reviewed.
- Review UI polish visible.
- Review URL opens Cavalry.
- Drafts apply only inside Cavalry.
- Reject/cancel works.
- Manual import fallback works.

## Manual Real ChatGPT Test

- Custom GPT created.
- Auth configured.
- Read endpoints tested.
- Draft endpoints tested.
- Destructive request tested.
- Review URL tested.
- Apply/reject tested in Cavalry.

## Known Limitations

- Not production cloud.
- Tunnel is beta/dev only.
- OAuth is not production-implemented.
- No direct ChatGPT apply.
- Local server must be running.
- Financial data privacy warning applies.
