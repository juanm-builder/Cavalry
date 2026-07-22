# OpenAPI Import Notes

Generate the beta OpenAPI file with:

```sh
CAVALRY_COMPANION_PUBLIC_BASE_URL="https://your-tunnel.example.com" npm run beta:openapi --workspace @cavalry/companion-api
```

Import `test-artifacts/companion-beta/openapi/cavalry-gpt-actions.beta.openapi.yaml` into the Custom GPT Action. Configure auth as Bearer/API key and use `<YOUR_BETA_API_KEY>` only in the GPT Action auth field.
