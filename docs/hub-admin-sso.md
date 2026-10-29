# Hub Admin sign-in

Medusa is an independent commerce service. Hub handles the operator's central sign-in; Medusa keeps its own operators, permissions, customers, products, orders, payments, refunds, inventory, and fulfillment.

## Entry and expiration

Set the Hub Medusa system entry to `https://[medusa-origin]/identity/start`. Do not link directly to `/app` when starting a Hub session.

The entry creates a browser-bound, ten-minute authorization attempt, redirects to the same-environment Hub, and exchanges a one-use authorization code on the server. A valid Hub browser session continues without another password prompt. Medusa verifies PKCE, state, nonce, the signed ID token, the current Hub identity, and the explicit operator binding before creating its native Admin session. Neither central nor local access tokens appear in the redirect URL.

The Admin login widget also starts this flow automatically when a native session expires or `/app/login` is opened directly. Central token expiry triggers another authorization flow, rather than extending an expired token. Each Admin browser request rechecks the current Hub identity and existing local operator/provider binding. Hub must be available for these requests.

An expired Hub session requires sign-in at Hub. An unassigned identity, deleted local operator, changed binding, or invalid callback is denied; it never creates an administrator automatically.

## Configuration

Configure all five fields together. Leaving all five unset/empty keeps the original native login behavior. Partial or invalid configuration prevents startup.

| Variable | Value |
| --- | --- |
| `HUB_IDENTITY_ORIGIN` | Same-environment Hub HTTPS origin, without a path |
| `HUB_IDENTITY_BROWSER_ORIGIN` | Optional Hub browser/console HTTPS origin; defaults to the canonical identity origin |
| `HUB_IDENTITY_CLIENT_ID` | Confidential Hub OAuth client ID |
| `HUB_IDENTITY_CLIENT_SECRET` | That client's server-only secret |
| `HUB_IDENTITY_PRODUCT_ID` | The Hub product registered for this Medusa environment |
| `HUB_IDENTITY_BINDINGS` | JSON array of exact issuer/subject/native-user bindings |
| `MEDUSA_PUBLIC_URL` | This Medusa service's HTTPS origin, without a path |

Example binding structure:

```json
[
  {
    "issuer": "https://[same-environment-hub-origin]/api/auth",
    "subject": "[verified-hub-user-id]",
    "userId": "[existing-medusa-user-id]"
  }
]
```

Use separate OAuth clients, products, bindings, and Medusa services for development and production. Issuers must exactly match the configured Hub origin plus `/api/auth`. Each subject and local user may appear only once. There is no email lookup or automatic account merge.

If Hub uses different API and console origins, `HUB_IDENTITY_ORIGIN` remains the canonical API origin used for discovery, issuer/JWKS checks, token exchange, resource, and current identity verification. Set `HUB_IDENTITY_BROWSER_ORIGIN` to its trusted same-environment console origin so the authorization page uses the existing console login cookie. Only the discovered authorization endpoint's origin changes; its path is preserved. Do not change Hub's established issuer to obtain a browser cookie.

Before binding an operator, confirm its existing local user ID and that it has exactly one native authentication identity. The callback attaches the Hub provider to that existing identity, preserving native MFA factors rather than creating a second identity. Conflicts are denied instead of silently changing the association.

Register the client with:

- Exact callback: `https://[medusa-origin]/identity/callback`.
- Authorization code grant with confidential `client_secret_basic` authentication and PKCE `S256`.
- Scopes: `openid profile platform:entitlements:read`.
- Resource: `https://[same-environment-hub-origin]/v1`.
- The Medusa product binding and the intended existing Hub operator access.
- Trusted/first-party consent settings if Hub requires this for immediate service entry.

This implementation does not request offline access or refresh tokens. Secrets and central access tokens remain server-side; native Redis session storage must remain private.

## Native authentication boundaries

When enabled, Admin users authenticate only through the `hub` provider. Storefront customers keep the native `emailpass` provider. Existing secret API keys continue to work for Admin automation under Medusa's native checks.

The public native `/auth/user/hub` token-login endpoint is disabled. The provider is called internally only after the browser callback has verified this Medusa client's signed ID token, state, and nonce. An access token issued to another client cannot be traded directly for a Medusa administrator session.

The callback calls Medusa's native MFA/email-verification checks. If an operator requires additional native verification, it refuses to establish a session and returns an explicit error; it does not bypass the requirement. Complete an intentional MFA integration before enabling Hub entry for such operators.

Logging out of Medusa clears its native session. A still-active Hub login can immediately authorize another Medusa session. Use Hub logout when the intention is to end central sign-in.

No Medusa core source, generated Admin files, database schemas, or Enterprise `auth-oidc` implementation are modified.

## Verification

Run from the repository root:

```bash
pnpm --filter @dtc/backend test:unit
pnpm --filter @dtc/backend exec tsc --noEmit
pnpm --filter @dtc/backend exec tsc --project src/admin/tsconfig.json --noEmit
pnpm --filter @dtc/backend build
```

For each deployed environment, retain Hub cookies while removing the Medusa session, then enter from Hub and confirm no password form appears. Also verify an expired native session, an expired central token with valid Hub cookies, an unassigned user, wrong issuer/product, logout/revocation, invalid state/nonce, callback replay, and unaffected customer/API-key authentication. Local mocked tests do not establish deployed browser success.
