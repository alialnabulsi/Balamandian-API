# Balamandian-API

The Balamandian mobile application's backend uses Node.js 24.22.2, Express 5,
strict TypeScript/ESM, PostgreSQL 18 and opaque bearer sessions in a modular
monolith. SIS owns institutional passwords/data; this API owns verified
application accounts, OTP registration and sessions. No application password exists.

Authentication is implemented. Real SIS verification and Resend email submission require
private configuration. See [authentication](docs/authentication.md) for exact
requests/responses and [architecture](docs/architecture.md) for module boundaries,
security decisions and official references.

## Local setup

Use Node **24.22.2** and npm **11.19.1**, recorded in the repository. The system
shell may still select Node 22; activate the installed version in every shell:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24.22.2
node --version
npm --version
npm ci
```

The existing local PostgreSQL **18.6** database `balamandian` is on port **5433**.
Preserve its installation, roles and credentials. PostgreSQL 17 on 5432 is
separate. See [local database notes](docs/local-database-setup.md).

For a new checkout, copy `.env.example` to ignored `.env`; never overwrite an
existing configured file. Supply database credentials, the SIS HTTPS origin and
service key, an independent random OTP secret and Resend settings. Exported
variables take precedence over `.env`; Node loads it natively. Never commit
credentials. Generate an OTP secret locally:

```sh
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

Store this value privately as `OTP_SECRET`. Changing it invalidates outstanding
codes but leaves application sessions intact.

```sh
npm run check
npm test
npm run db:migrate
npm start
```

Migrations are explicit, never part of HTTP startup. Use schema-owning credentials
for migrations. The existing local role is `postgres`; it was reused without
creating/modifying roles. Production needs a restricted runtime role and separate
migration role.

Startup validates all configuration and verifies PostgreSQL major 18 before
listening. Missing SIS/OTP/Resend settings fail startup. Invalid provider credentials,
rate limits, network failures, malformed responses and timeouts return the existing
`503 EMAIL_UNAVAILABLE` response. Provider acceptance does not confirm recipient
delivery. Ctrl+C or SIGINT/SIGTERM drains HTTP and ends the pool within
the existing ten-second deadline.

## Configuration

| Variable                             | Default                        | Purpose                                                                |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------- |
| `HOST`, `PORT`                       | `127.0.0.1`, `3000`            | Validated bind address/port.                                           |
| `NODE_ENV`                           | Express default                | Set `production` in production.                                        |
| `PGHOST`                             | `127.0.0.1`                    | Only loopback/localhost supported.                                     |
| `PGPORT`                             | Parser `5432`; template `5433` | Existing PostgreSQL 18 uses 5433.                                      |
| `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Required                       | Explicit connection; `DATABASE_URL` is not consumed.                   |
| `DB_POOL_MAX`                        | `5`                            | Maximum 20 connections.                                                |
| `DB_CONNECTION_TIMEOUT_MS`           | `5000`                         | Maximum 30000.                                                         |
| `DB_STATEMENT_TIMEOUT_MS`            | `10000`                        | Maximum 120000; query timeout is this plus 1000.                       |
| `SIS_BASE_URL`                       | Required                       | HTTPS origin without path, query, fragment or credentials.             |
| `SIS_SERVICE_API_KEY`                | Required                       | Private backend service key.                                           |
| `SIS_TIMEOUT_MS`                     | `5000`                         | Whole fetch/body timeout; maximum 15000; no retries.                   |
| `OTP_SECRET`                         | Required                       | Independent 32 random bytes encoded as 64 hex characters.              |
| `SESSION_LIFETIME_SECONDS`           | `604800`                       | Seven days; range 1–2592000.                                           |
| `RESEND_API_KEY`                     | Required                       | Private sending key authorized for your Resend-verified domain.        |
| `RESEND_FROM_EMAIL`                  | Required                       | Single sender mailbox on that verified domain, without a display name. |
| `RESEND_TIMEOUT_MS`                  | `5000`                         | Entire SDK request and response deadline, range 1–15000 ms.            |

Numeric settings reject empty, nondecimal, zero and excessive values. Resend is
the sole email provider in local development and production, through its official
Node SDK and fixed `https://api.resend.com` destination. The key stays exclusively
on the backend. Set a sending key restricted to your verified domain where possible.
Do not enable `RESEND_DEBUG=true`: startup rejects it because SDK error bodies may
contain sensitive data. `RESEND_BASE_URL` is deliberately ignored by the adapter.
There is no SMTP fallback, console OTP mode or development delivery bypass.

Automated tests mock the SDK/HTTPS responses and never send real email. Manual
registration or resend with valid local credentials submits real email to Resend.
A valid response with an email id means Resend accepted the submission; it does
not prove delivery. Use the Resend dashboard for later delivery/bounce status;
delivery webhooks are outside the current API scope. No automatic send retries
are performed, including ambiguous timeouts. Existing cooldowns and resend budgets
still apply. Old `SMTP_*` settings are unused and may be removed from local files.

The fixed policy in `auth.security.ts` is six digits, at most ten minutes, five
failed attempts, sixty-second cooldown and three resends per one-hour window.
Repeated registration shares persistent limits and rotates the opaque id.

## Commands and testing

| Command                                                 | Purpose                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                                           | Build then start; rerun after edits.                                                                               |
| `npm start`                                             | Run compiled ESM with optional `.env` loading.                                                                     |
| `npm run build`                                         | Compile into ignored `dist/`.                                                                                      |
| `npm run db:migrate`                                    | Build then run the preserved tracked SQL runner.                                                                   |
| `npm test`                                              | Build once; run config, security, HTTP, SIS/Resend-adapter and migration-file tests with mocked external services. |
| `npm run test:integration`                              | Build, create a separate PostgreSQL test database, run mocked SIS/email scenarios, drop that database.             |
| `npm run check`                                         | Typecheck, ESLint (zero warnings), Prettier check.                                                                 |
| `npm run typecheck`, `npm run lint`, `npm run lint:fix` | Individual checks.                                                                                                 |
| `npm run format`, `npm run format:check`                | Formatting/checking.                                                                                               |

Integration tests require PostgreSQL 18 credentials with CREATE DATABASE
permission. They create a random `balamandian_auth_<uuid>_test` database; destructive
fixtures run there, never against development data or an existing test database.
No roles are created. A forced process kill may leave that generated database for
manual cleanup. Private PGUSER/PGPASSWORD process overrides may be used.

For one verification pass without rebuilding twice:

```sh
npm run check
npm test
node --env-file-if-exists=.env --test test/integration/*.test.js
```

Tests never use deployed SIS or send real email. Real PostgreSQL tests cover all
authentication flows, OTP expiry/limits/replay/resend/concurrency, rollback, email
failure/in-flight delivery, account status and session restoration/expiry/logout.
They apply the migration and verify an idempotent repeat.

After full configuration, `GET /health` returns `{"status":"ok"}` for HTTP
liveness only. On PowerShell:
`curl.exe --fail http://127.0.0.1:3000/health`.

## Workflow and deployment boundaries

Keep strict TypeScript/NodeNext ESM, explicit `.js` relative imports and ordinary
constructor/factory injection. Dependencies are exact-pinned with the lockfile.
Engine restrictions and disabled dependency lifecycle scripts remain intact.
No ORM, Redis, queue, guest login, refresh tokens, frontend changes or deployment
infrastructure are introduced.

`resend@6.37.0` is exact-pinned. Its published declarations also require
`@types/react@19.3.0`, even for plain-text mail; no React runtime or email-rendering
package is installed. A small `resend-node.d.ts` aliases the SDK's missing global
`HeadersInit` to Node's existing fetch header type. Strict library checking and
the existing server-only TypeScript configuration remain enabled.

Process-local abuse counters suit single-instance development. Multi-instance
production needs shared rate limiting, reviewed HTTPS/proxy configuration,
least-privilege database credentials, secret management, retention/cleanup and
redacted monitoring. Do not enable proxy trust without matching the host topology.

The existing audit follow-up remains: 11 moderate entries in the development lint
dependency tree from [the minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
No forced major override is applied. Keep lint patterns trusted and review
compatible upstream fixes when maintaining that stack.

Keep work uncommitted on `dev`; do not commit or push unless instructed.
