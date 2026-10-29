# Hub Admin single sign-on

## Objective

Allow an operator with a valid same-environment Hub session to enter Medusa Admin without another credential prompt. Keep commerce, customer authentication, payments, refunds, and existing operator permissions in Medusa.

## Implementation

1. Add optional, all-or-nothing Hub identity configuration and explicit issuer/subject-to-existing-user bindings. Never identify or merge operators by email.
2. Implement a server-side authorization-code flow with PKCE, state, nonce, verified discovery/JWKS, token validation, and a current Hub identity check.
3. Register a generic custom Hub auth provider, associate only approved existing native operators, and establish the native Admin session with Medusa authentication checks.
4. Add an Admin login widget that automatically starts Hub sign-in. Revalidate central identity and the local binding on Admin requests. Keep customer email/password authentication.
5. Document registration, same-environment setup, access mapping, expiry behavior, and failure handling.

## Affected areas

- Backend environment schema and Medusa auth configuration.
- Identity helpers, custom auth provider, identity routes, Admin middleware/widget.
- Targeted security tests and development documentation.

## Verification

- Unit tests for configuration, exact identity mapping, PKCE/state/nonce, wrong issuer/product, callback replay, central expiry, deleted local user, and native session checks.
- Type check and backend/Admin build.
- Required `ai-code-check` review of the complete entry/callback/session/request chain.
- Live Hub client registration, credentials, deployment, and browser verification are coordinated by the parent task and are outside this source-only implementation.

## Progress

- [x] Inspected Medusa 2.22.1 auth providers, actor binding workflow, native session implementation, and login widget extension.
- [x] Implement source and configuration.
- [x] Run targeted tests/build.
- [x] Perform `ai-code-check` and address material findings.
- [x] Record final result and remaining verification.

## Final outcome

Implemented the same-environment browser entry, server-side PKCE/state/nonce flow, explicit operator mapping on the existing native authentication identity, checked native session creation, central/local revalidation, automatic native login-page entry, and public raw-token login rejection. Added an optional trusted browser origin for environments whose console and canonical identity API use different origins.

Verification completed on 2026-10-30:

- Full backend unit suite: **66 tests passed across 7 suites**.
- Backend TypeScript check passed.
- Admin TypeScript check passed.
- SSO-enabled split-origin backend and Admin build passed using synthetic nonsecret environment values; zero lint warnings/errors.
- Local real HTTP tests cover canonical, percent-encoded, and trailing-slash GET/POST token-login routes plus the preserved customer provider path.
- `git diff --check` passed; every new/modified source file is below 400 lines.
- Required review is recorded in `plan/2026-10-30-hub-admin-sso-code-check.md`; no unresolved material source findings.

No live credentials, infrastructure, or database changes were made. The parent task owns real OAuth registration/configuration, native operator mapping, deployment, and browser verification in both environments. An already-open Admin view relies on native routing to reach its login widget; every entry from Hub starts fresh authorization. Existing native MFA/verification requirements fail closed and require a separate intentional UI integration before such an operator can use this flow.

## Coordinated runtime outcome

The parent task completed production and development registration and rollout after this source implementation. Both real browser flows reached `/app/orders` through their same-environment Hub without entering either Hub or Medusa credentials. Anonymous native Admin reads return 401, and public raw-token login returns 403. Production bootstrap credentials were removed from runtime variables, and the final pre-deploy command only runs safe native migrations. Runtime source is `ad7481e62e9bd74c9529a46ba089262d8aa9b632`; current evidence is in `deploy/sso-verification.json`.
