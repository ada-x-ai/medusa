# Independent Hub commerce service

This repository is a fork of the official `medusajs/dtc-starter`. The backend and native Medusa Admin are deployed independently from Hub. The optional storefront source is retained but is not deployed in this integration.

## Ownership

Medusa owns merchandise, carts, product orders, payments, refunds, inventory and fulfillment. Hub continues to own service subscriptions, token-credit purchases and usage metering. No commerce order is mirrored into Hub, and no token product, payment proxy or shared billing workflow is introduced.

The Hub Console opens the native Admin through `/identity/start`. Hub single sign-on verifies the current central session and maps it to an explicitly authorized existing Medusa operator. The native account, permissions, API keys and commerce data remain owned by Medusa. See [Hub Admin SSO](../docs/hub-admin-sso.md).

## Deployment

Build the repository root `Dockerfile`. It pins Node 24.22.1 and pnpm 10.11.1 and builds only `@dtc/backend` from the frozen lockfile. Application commands run in `/app/apps/backend/.medusa/server` with the generated backend and Admin assets.

Provide an isolated PostgreSQL database and Redis service. Never use Hub's business database or its billing/payment credentials.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (runtime validation mode, not a production business environment) |
| `DATABASE_URL` | Independent Medusa database connection; development private Railway PostgreSQL uses `sslmode=disable`, production Neon uses `sslmode=verify-full` |
| `REDIS_URL` | Private connection to the independent Medusa Redis |
| `MEDUSA_PUBLIC_URL` | Public HTTPS origin of this Medusa instance |
| `JWT_SECRET` | Independent random secret, at least 32 characters |
| `COOKIE_SECRET` | A different independent random secret, at least 32 characters |
| `STORE_CORS` | Empty until a storefront is deployed |
| `PORT` | `9000` |
| `MEDUSA_DISABLE_TELEMETRY` | `true` |

Admin and authentication CORS are restricted to the `MEDUSA_PUBLIC_URL` origin. Native commerce access and credentials remain independent from Hub.

The isolated Railway PostgreSQL service uses a private network connection without TLS. Set the database URL's `sslmode` query parameter explicitly to `disable` for this service. Medusa's migration driver otherwise treats a non-local hostname as a TLS endpoint even when the initial shared connection succeeded, which can produce a misleading migration `SELECT 1` timeout. Keep TLS enabled with the appropriate verification settings for public or managed database connections; do not disable SSL globally or increase migration timeouts to conceal this mismatch.

Each isolated administration instance runs one replica in Medusa's `shared` server/worker mode. Redis backs events, durable workflows and locking. No storefront or live payment provider is enabled by this integration. Before increasing replicas, split the server/worker processes and configure shared object storage.

Mount persistent media storage at `/app/apps/backend/.medusa/server/static`. The entrypoint assigns the mounted directory to the `node` user and immediately starts the process as that user. The local file provider uses a dedicated persistent volume in each environment. Use shared object storage before scaling to multiple replicas.

Configure the Railway service explicitly: Dockerfile builder, root `Dockerfile`, one replica, `/health` health check with a 300-second timeout, restart on failure with three retries, and the following pre-deploy command. Read back the effective deployment manifest before accepting a release; this repository does not depend on deprecated Config as Code files.

The normal pre-deploy command is:

```sh
pnpm exec medusa db:migrate --skip-scripts --execute-safe-links --execute-safe-search
```

`--skip-scripts` deliberately excludes the upstream starter's automatic demo-product seed. The installed Medusa loader still runs its own `createDefaultsWorkflow` on startup, creating a default Store, sales channel and publishable key only when absent; the native default Store currency is EUR. A second custom initializer is unnecessary. No existing Hub database or store is migrated. The normal start command is `pnpm exec medusa start`; `/health` is the readiness endpoint and `/app` is the native Admin.

Create the first operator through Medusa's native user command as a separate, one-time provisioning step using private, independently generated credentials. If supplying credentials through temporary service environment variables, invoke an explicit shell to expand them; do not append a bare shell chain to a CLI command. Remove the temporary variables and restore the migration-only pre-deploy command before the normal runtime rollout. Do not commit or print the credentials. Actual payment providers remain unconfigured until the merchant account and intended payment environment are explicitly selected.

## Verification

Run backend build/lint and the runtime-environment boundary tests. After deployment, verify `/health`, the `/app` login page, anonymous rejection at `/admin/products`, and authorized native operator login. A healthy management backend does not establish real payment or refund acceptance.

## Current Hub SSO deployments

| Environment | Hub browser entry | Medusa entry |
| --- | --- | --- |
| Development | [Development Hub](https://hub-dev-console-dev.up.railway.app/console/systems) | [Development Medusa](https://hub-medusa-dev.up.railway.app/identity/start) |
| Production | [Production Hub](https://hub-console-production.up.railway.app/console/systems) | [Production Medusa](https://hub-medusa-production-production.up.railway.app/identity/start) |

Both deployments were verified in the real browser with an existing same-environment Hub login and without entering a Medusa password. Development preserves the canonical API issuer while browser authorization uses the Console proxy. Production uses the production Console for both. Native Admin password login is unavailable once the Hub-only operator provider is enabled; storefront customer authentication and API keys remain separate.

[SSO verification](sso-verification.json) records the current runtime source and deployment IDs. The earlier `verification.json` is the historical independent-service bootstrap receipt.
