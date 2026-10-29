# Independent Hub commerce service

This repository is a fork of the official `medusajs/dtc-starter`. The backend and native Medusa Admin are deployed independently from Hub. The optional storefront source is retained but is not deployed in this integration.

## Ownership

Medusa owns merchandise, carts, product orders, payments, refunds, inventory and fulfillment. Hub continues to own service subscriptions, token-credit purchases and usage metering. No commerce order is mirrored into Hub, and no token product, payment proxy or shared billing workflow is introduced.

The Hub Console opens the Medusa native Admin in a new tab. This is a navigation link, not single sign-on; Medusa requires its own authorized operator login.

## Development deployment

Build the repository root `Dockerfile`. It pins Node 24.22.1 and pnpm 10.11.1 and builds only `@dtc/backend` from the frozen lockfile. Application commands run in `/app/apps/backend/.medusa/server` with the generated backend and Admin assets.

Provide an isolated PostgreSQL database and Redis service. Never use Hub's business database or its billing/payment credentials.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (runtime validation mode, not a production business environment) |
| `DATABASE_URL` | Private connection to the independent Medusa database |
| `REDIS_URL` | Private connection to the independent Medusa Redis |
| `MEDUSA_PUBLIC_URL` | Public HTTPS origin of this Medusa instance |
| `JWT_SECRET` | Independent random secret, at least 32 characters |
| `COOKIE_SECRET` | A different independent random secret, at least 32 characters |
| `STORE_CORS` | Empty until a storefront is deployed |
| `PORT` | `9000` |
| `MEDUSA_DISABLE_TELEMETRY` | `true` |

Admin and authentication CORS are restricted to the `MEDUSA_PUBLIC_URL` origin. Native commerce access and credentials remain independent from Hub.

The isolated development instance runs one replica in Medusa's `shared` server/worker mode. Redis backs events, durable workflows and locking. Before increasing replicas or treating the service as a production store, configure separate server/worker deployment and shared object storage.

Mount persistent media storage at `/app/apps/backend/.medusa/server/static`. The entrypoint assigns the mounted directory to the `node` user and immediately starts the process as that user. The local file provider is used only for this isolated development instance; use an object-storage provider for production.

The Railway pre-deploy command is:

```sh
pnpm exec medusa db:migrate --skip-scripts --execute-safe-links --execute-safe-search
```

`--skip-scripts` deliberately excludes the upstream starter's automatic demo-product seed. No existing Hub database or store is migrated. The normal start command is `pnpm exec medusa start`; `/health` is the readiness endpoint and `/app` is the native Admin.

Create the first operator through Medusa's native user command using private, independently generated credentials. Do not commit or print the credentials. Actual payment providers remain unconfigured until the merchant account and intended payment environment are explicitly selected.

## Verification

Run backend build/lint and the runtime-environment boundary tests. After deployment, verify `/health`, the `/app` login page, anonymous rejection at `/admin/products`, and authorized native operator login. A healthy management backend does not establish real payment or refund acceptance.
