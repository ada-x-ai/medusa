# AI code check: Hub Admin sign-in

## Findings

No unresolved material source findings after the fixes below.

- Closed the public raw-token login path. Only the internal browser callback may invoke the Hub provider after verifying this client's signed identity token. The middleware uses Express-decoded actor/provider fields, including percent-encoded paths.
- Reused the local operator's existing native authentication identity rather than creating an identity that would omit existing MFA factors.
- Kept the canonical API issuer separate from the optional browser console origin. Only the browser authorization origin changes; token, JWKS, resource, and current identity verification remain canonical.
- Replaced generic configuration errors identified by the build lint with typed identity errors.

## Goal and approach

An operator with a valid same-environment Hub browser session enters Medusa without another password prompt. The public entry starts a browser-bound authorization code flow, validates the signed central proof and live product identity, binds an approved existing operator, and uses Medusa's native authentication checks to establish its server-side session. Admin requests revalidate central and local identity. Customer and secret API-key authentication retain their native paths.

## Change Impact Map

```text
HubLogin [src/admin/widgets/hub-login.tsx:4, entrypoint, added]
  calls -> GET /identity/config [src/api/identity/config/route.ts:7, entrypoint, added]
  calls -> startIdentity [src/lib/identity/session.ts:36, entrypoint, added]
startIdentity
  reads -> identityConfiguration [src/lib/identity/configuration.ts:48, model, added]
  calls -> createFlow / authorizationUrl [src/lib/identity/protocol.ts:30, callee, added]
  persists -> native Redis session.identityFlow [session.ts:44, persistence, added]
  emits -> Hub authorization URL [protocol.ts:75, external dependency, added]
completeIdentity [session.ts:54, entrypoint, added]
  restores / consumes -> session.identityFlow [session.ts:59, persistence, added]
  calls -> callbackCode / exchangeCode [protocol.ts:89, callee, added]
exchangeCode
  reads -> canonical discovery, token endpoint, trusted JWKS [protocol.ts:120, external dependency, added]
  calls -> jose.jwtVerify [protocol.ts:140, external dependency, added]
  calls -> currentIdentity / Hub GET /v1/identity [protocol.ts:108, external dependency, added]
completeIdentity
  calls -> ensureOperatorIdentity [src/lib/identity/operator.ts:16, callee, added]
ensureOperatorIdentity
  reads -> existing User and AuthIdentity via native modules [operator.ts:20, model, unchanged context]
  writes -> native ProviderIdentity on the existing AuthIdentity [operator.ts:36, persistence, added]
completeIdentity
  calls -> HubAuthService.authenticate [src/modules/hub-auth/service.ts:15, callee, added]
HubAuthService.authenticate
  calls -> currentIdentity
  reads -> exact configured issuer/subject binding and registered provider identity
completeIdentity
  calls -> generateJwtTokenWithChecks [@medusajs/medusa/api/auth/utils/generate-jwt-token, callee, unchanged context]
  calls -> getAuthContextFromJwtToken [@medusajs/framework/http, callee, unchanged context]
  persists -> regenerated native Redis session.auth_context / hubIdentity [session.ts:89, persistence, added]
Admin request [src/api/middlewares.ts:13, caller, modified]
  calls -> native authenticate [middlewares.ts:15, callee, unchanged context]
  calls -> requireHubOperator [session.ts:103, callee, added]
requireHubOperator
  restores -> session.hubIdentity [session.ts:109, persistence, added]
  calls -> validateOperatorSession [operator.ts:41, callee, added]
validateOperatorSession
  calls -> currentIdentity
  reads -> current binding, local User, AuthIdentity, ProviderIdentity [operator.ts:51, model, added]
rejectHubTokenLogin [session.ts:30, entrypoint, added]
  consumes -> decoded actor_type / auth_provider route parameters [middlewares.ts:8, caller, modified]
  verified_by -> routing.unit.spec.ts [test, added]
configuration / protocol / operator / native-session lifecycle
  verified_by -> configuration.unit.spec.ts / protocol.unit.spec.ts / operator.unit.spec.ts / session.unit.spec.ts [tests, added]
HubAuthService.authenticate
  verified_by -> modules/hub-auth/__tests__/service.unit.spec.ts [test, added]
```

Paths above are relative to `apps/backend/` unless a package path is given.

## State and contract review

| State / boundary | Result |
| --- | --- |
| Identity disabled | Default native Admin/customer behavior; login widget remains inactive |
| Partial or invalid configuration | Startup rejects it |
| Authorization attempt | Native session regenerated, state/PKCE verifier/nonce saved before redirect |
| Callback success | Attempt consumed; issuer/audience/signature/age/nonce and live product identity checked; native session regenerated again |
| Callback failure/replay | No native session created; consumed attempt cannot be reused |
| Binding conflict / missing or ambiguous native identity | Denied; no email matching, no new operator, no overwritten association |
| Existing native MFA or email verification required | Native checks refuse session creation; no bypass |
| Restored session | Expiry, issuer, product, client, subject, native actor, existing user and provider association checked |
| Central rejection or changed local binding | Admin request denied and local session destroyed |
| Secret API-key automation | Native secret-key verification remains authoritative |
| Native customer provider | Continues through its native route |
| Canonical and browser origins differ | Only authorization uses the trusted browser origin; cryptographic/server checks retain canonical API issuer |

No database schema or core-source changes. The only new persistent authentication data are native provider associations and private Redis session fields. Existing native associations, operator permissions, and MFA factors are retained.

## Verification

Results and final count are recorded in the implementation plan. Verification includes real signed ID-token checks, mocked central/session boundaries, and real local HTTP routing with the framework's Express dependency. The split-origin SSO-enabled backend and Admin build uses synthetic nonsecret configuration, not live databases or credentials.

## Second pass and remaining risk

Rechecked callers, provider registration, parsed HTTP routing, native MFA checks, state consumption, session regeneration/restoration, endpoint origin checks, disabled defaults, customer path, and API-key path after verification. No remaining source-level material finding.

Deployment, real Hub consent/cookie behavior, native Redis sessions, and the mapped live operator still require browser verification by the parent task. Additional native MFA UI is intentionally absent; operators requiring it receive an explicit error. An unavailable Hub prevents authenticated browser Admin requests. An already-open Admin page relies on native routing to reach the login widget; entering through Hub always starts fresh authorization.
