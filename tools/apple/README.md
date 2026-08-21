# Apple client secrets

Cavalry needs **two** Apple client-secret JWTs. They are signed with the same
Sign in with Apple key but carry different `sub` claims, and they are **not**
interchangeable.

| Secret    | `sub` (client ID)                             | Destination                                                | Breaks if expired                                                                                       |
| --------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Web OAuth | `com.juanmbuilder.cavalry.auth` (Services ID) | Supabase → Auth → Providers → Apple → **Secret Key**       | Mac browser sign-in fails outright                                                                      |
| Native    | `com.juanmbuilder.cavalry.ios` (App ID)       | Supabase Edge Function secret `APPLE_NATIVE_CLIENT_SECRET` | Account deletion still completes, but stops revoking Apple tokens and falls back to manual instructions |

Apple caps a client secret at six months. Rotate both before expiry.

## Generating

`client-secret.mjs` signs locally with `node:crypto` and has no dependencies.
The `.p8` key is read from disk, used to sign, and never written or
transmitted anywhere.

```bash
node tools/apple/client-secret.mjs \
  --key "$HOME/path/to/AuthKey_XXXXXXXXXX.p8" \
  --key-id XXXXXXXXXX \
  --team-id U8H23USGUJ \
  --client-id com.juanmbuilder.cavalry.auth
```

Repeat with `--client-id com.juanmbuilder.cavalry.ios` for the native secret.

A summary of the claims goes to stderr and the token alone to stdout, so the
summary can be read while piping the token elsewhere. Check the printed `sub`
before copying — swapping the two secrets produces failures that never mention
the secret.

`--lifetime-seconds` overrides the default (just under Apple's 15777000-second
maximum).

## Handling the key and the secrets

The `.p8` is downloadable exactly once. Keep it outside every repository, in a
password manager or encrypted storage, readable only by your user
(`chmod 600`). If it is lost or exposed, revoke the key in Apple Developer and
issue a new one; both secrets must then be regenerated.

Never commit a `.p8`, a generated secret, or a Supabase secret/service-role key.
Set the native secret through the Supabase dashboard rather than
`supabase secrets set`, which would record it in shell history.

## Related

- Provider and identity setup: [`docs/features/cavalry-cloud.md`](../../docs/features/cavalry-cloud.md)
- iOS-side setup: `docs/apple-authentication.md` in the Cavalry Mobile repository
