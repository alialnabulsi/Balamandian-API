# Authentication implementation report

Historical record of the initial backend implementation. Email delivery has since
been replaced by the official Resend HTTPS SDK; see the current
[authentication contract](authentication.md#delivery-and-configuration-boundaries)
and [README configuration](../README.md#configuration). SMTP setup and the local
configuration-blocker statements below describe the original implementation,
not the current provider or current local environment.

Completed locally on 2026-11-02, on branch `dev`, without commits, pushes or
deployment. Existing PostgreSQL infrastructure and the migration runner were
preserved. Neither the Flutter repository nor SIS-API was modified.

## Database and migration

`database/migrations/0001_authentication.sql` was applied successfully to the
existing `balamandian` database on PostgreSQL 18.6, port 5433. Read-only inspection
confirmed migration version 1, the three new tables, and the existing
`schema_migrations` table. All three authentication tables contain zero rows;
no test identities were inserted into development data. No roles, grants or
installation settings were changed. Migration execution used the existing local
configured `postgres` role.

| Table                  | Relationships and constraints                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_user`             | Internal UUID primary key; unique required canonical SIS id; institutional email; email verification timestamp; active/disabled application status; creation/update timestamps. Active accounts require verified email. Email is not an identity/linking key.                                                                                      |
| `pending_registration` | Opaque UUID primary key and one retained challenge per canonical SIS id; HMAC verifier; OTP and registration-window expiry; failed attempts constrained to 0–5; resend count constrained to 0–3; cooldown; sending/sent/failed delivery state; consumption/invalidation and creation/update timestamps. Registration replacement rotates the UUID. |
| `app_session`          | UUID primary key; `user_id` references `app_user.id` with cascading deletion; unique SHA-256 token hash; creation/expiry/revocation timestamps; expiry must follow creation. Indexes support user lookup and expiry cleanup.                                                                                                                       |

Future application entities must reference `app_user.id`. No academic tables,
student/instructor account tables or future-feature schemas were created.

## HTTP, SIS, OTP and sessions

The [HTTP contract](authentication.md) includes exact requests and responses for:

| Method | Endpoint                       | Success                                                      |
| ------ | ------------------------------ | ------------------------------------------------------------ |
| POST   | `/api/v1/auth/register`        | 202 with opaque pending id and code/cooldown expiry.         |
| POST   | `/api/v1/auth/register/verify` | 201 with verified user and newly issued bearer session.      |
| POST   | `/api/v1/auth/register/resend` | 202 with pending id and updated expiry/cooldown.             |
| POST   | `/api/v1/auth/login`           | 200 with the same authentication response as verification.   |
| GET    | `/api/v1/auth/me`              | 200 with identity and session expiry, without the raw token. |
| POST   | `/api/v1/auth/logout`          | 204, revoking the current session only.                      |

The SIS adapter uses built-in fetch to call the configured HTTPS origin's
`POST /api/v1/auth/verify` once, with backend service bearer authentication and
identifier/password JSON. It rejects redirects, bounds time/body size, validates
canonical identity/email, and accepts optional nested academic fields without
persisting them. It distinguishes bad member credentials from bad service
credentials, rate limiting, outages and malformed responses. No extra member
request occurs. Every new login verifies SIS; no password is stored locally.

OTP generation is cryptographically random and six digits. Verifiers use keyed
HMAC-SHA-256 bound to the opaque registration id. Policy: ten-minute maximum
validity, five failed attempts per issued code, sixty-second resend cooldown,
three resends per one-hour registration window. Window expiry caps a code's
effective validity. Repeated registration cannot reset delivery limits; resend
invalidates the previous code. Persistent locking/constraints prevent duplicate
accounts and successful OTP replay. Account/session creation and consumption are
one transaction; incorrect attempts commit persistently.

Nodemailer delivers via configured SMTP with TLS/STARTTLS, bounded connection and
socket waits, no debug logging and no file/URL content access. SMTP runs outside
database transactions; a challenge is unusable until delivery is accepted.
Failure returns an error and retains delivery limits. A stale completion cannot
activate a replacement. A private local SMTP capture inbox is supported; automated
tests inject a fake mailer. Missing settings fail startup. SMTP acceptance cannot
guarantee inbox delivery or an atomic SMTP/database commit; documented retries
handle delivery/database failure windows without creating an active account.

Sessions use 32 random bytes encoded as base64url, persist only SHA-256 hashes,
and initially expire in seven days. Every protected request checks expiration,
revocation and application account status. `/me` restores sessions without SIS;
logout revokes the current one. There is no refresh token or sliding renewal.

## Verification results

- `npm test`: build passed; all 15 database-independent tests passed.
- Final `npm run check`: strict typecheck, ESLint with zero warnings and full
  Prettier check passed. An initial formatter check identified one controller
  formatting issue; it was corrected before the final passing check.
- `node --env-file=.env --test test/integration/*.test.js`: 18 database-backed
  scenarios passed (19 Node test-runner entries including the parent). SIS/email
  were mocked. Real transactions covered registration, invalid credentials,
  conflicts, OTP expiry/attempts/replay, resend/cooldown/budget, concurrent
  registration/verification, in-flight/stale delivery, rollback, login by id/email,
  account status, email-linking prevention, sessions/expiry/revocation and all six
  HTTP endpoints.
- Isolated tests applied the real migration and verified an idempotent repeat.
  All generated test databases were dropped; inspection found none remaining.
- Compiled migration command: one migration applied successfully to development.
  Read-only schema/history/row-count inspection passed.
- `git diff --check`: passed. `.env` remains ignored and unchanged.
- Actual server startup with the existing incomplete authentication environment
  exited nonzero with the safe generic configuration message, as designed.

The final database verification reused the build from `npm test`; no redundant
build was needed for migration. Tests never called deployed SIS or sent real mail.
The dependency install still reports the existing 11 moderate development lint
dependency entries; no forced dependency override was applied.

## Remaining local configuration and production boundaries

The existing ignored `.env` has working database settings but no authentication
integration settings. Supply the real `SIS_BASE_URL`, `SIS_SERVICE_API_KEY`, a
fresh random 64-hex-character `OTP_SECRET`, and the documented SMTP host, port,
security mode, sender and credentials. Session lifetime defaults to 604800
seconds. See [.env.example](../.env.example) and [README](../README.md).

No successful live SIS verification or email delivery is claimed. A fully
configured real server startup and live end-to-end registration remain dependent
on those external credentials/services. Mocked HTTP flows and real PostgreSQL
persistence are verified independently.

Before multi-instance production, replace process-local rate counters with shared
enforcement, review TLS/proxy trust, use restricted runtime database credentials,
and define secret management, redacted monitoring and retention/cleanup. The
current configured local database role is a superuser; no role changes were
authorized or made. Existing sessions do not continuously recheck institutional
status. These boundaries are documented in [architecture](architecture.md), along
with the official Node, Express, PostgreSQL, Nodemailer and OWASP references.

## Created and modified files

Created (18):

- `database/migrations/0001_authentication.sql`
- `docs/authentication.md`
- `docs/authentication-implementation-report.md`
- `src/config/auth.ts`
- `src/integrations/email/smtp.adapter.ts`
- `src/integrations/sis/sis.adapter.ts`
- `src/modules/auth/auth.composition.ts`
- `src/modules/auth/auth.controller.ts`
- `src/modules/auth/auth.middleware.ts`
- `src/modules/auth/auth.repository.ts`
- `src/modules/auth/auth.routes.ts`
- `src/modules/auth/auth.security.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/auth.types.ts`
- `src/modules/auth/auth.validators.ts`
- `src/shared/http-error.ts`
- `test/auth.test.js`
- `test/integration/auth.test.js`

Modified (9):

- `.env.example`
- `README.md`
- `database/migrations/README.md`
- `docs/architecture.md`
- `docs/local-database-setup.md`
- `package.json`
- `package-lock.json`
- `src/app.ts`
- `src/server.ts`

Git state: `dev` tracking `origin/dev`, nine modified tracked files and eighteen
new files, all unstaged/uncommitted. No commit, push or deployment was performed.
