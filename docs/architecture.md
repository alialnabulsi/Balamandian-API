# Approved backend architecture

Status: modular monolith with working HTTP/database infrastructure and complete
authentication. Baseline: Node.js 24.22.2, npm 11.19.1, Express 5, strict
TypeScript/NodeNext ESM and local PostgreSQL 18.6. No ORM is used.

## Ownership and identity

| System                 | Responsibility                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Flutter Android app    | UI and secure client session storage; calls this backend only.                             |
| Balamandian-API        | Verified application accounts, OTP registration, sessions and future application behavior. |
| SIS-API                | Institutional passwords and canonical identity over HTTPS.                                 |
| Application PostgreSQL | Application state, separate from academic data.                                            |

All future application entities reference internal UUID `app_user.id`. The unique
SIS id is an external identity; email is a verified contact. Neither is an
application-data primary key or an email-based account-linking key. SIS roles and
academic profiles are not persisted or interpreted as application permissions.

## Module boundaries

```text
HTTP router/controller -> AuthService -> AuthRepository -> PostgreSQL
                              |-> SisGateway -> SisAdapter -> HTTPS SIS
                              |-> OtpMailer -> ResendMailer -> Resend HTTPS API
```

These are project conventions, not Express requirements. Services have no Express
objects; repositories own parameterized SQL/transactions; adapters own external
operations. Constructor/factory injection composes them without a DI framework,
base repository or speculative infrastructure.

| Location                                          | Responsibility                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/app.ts`                                      | Compose routes, security headers and safe errors without listening.    |
| `src/server.ts`                                   | Startup, database version check, HTTP lifecycle and cleanup.           |
| `src/config/auth.ts`                              | Validate SIS/OTP/Resend/session configuration.                         |
| `src/modules/auth/auth.composition.ts`            | Wire service, repository and adapters.                                 |
| `auth.routes.ts` / `auth.controller.ts`           | Routes, strict DTOs, statuses and responses.                           |
| `auth.service.ts`                                 | Registration, login and session business rules.                        |
| `auth.repository.ts`                              | Persistence, parameterized SQL and transactions.                       |
| `auth.middleware.ts`                              | Bearer checks and bounded single-instance counters.                    |
| `auth.security.ts`                                | OTP policy, HMAC verifiers and random tokens.                          |
| `auth.types.ts` / `auth.validators.ts`            | Contracts and runtime validation.                                      |
| `src/integrations/sis/sis.adapter.ts`             | SIS contract, bounded fetch and safe errors.                           |
| `src/integrations/email/resend.adapter.ts`        | Official Resend SDK, HTTPS, deadline and safe acceptance validation.   |
| `src/integrations/email/resend-node.d.ts`         | SDK declaration compatibility with Node's existing fetch header types. |
| `src/shared/http-error.ts`                        | Safe status/code/message and optional Retry-After.                     |
| `src/shared/database/` / `src/scripts/migrate.ts` | Preserved pool, version check and SQL runner.                          |
| `database/migrations/0001_authentication.sql`     | First authentication schema.                                           |

Auth filenames in this table are under `src/modules/auth/`.

## Database and concurrency

`app_user`: internal UUID, unique required canonical SIS id, institutional email,
verification timestamp, active/disabled application status and timestamps. Active
rows must have verified email. Only OTP verification creates an active account.

`pending_registration`: one retained row per SIS id, opaque UUID, HMAC-SHA-256
verifier, code/window expiry, persistent failed attempts, resend count/cooldown,
delivery state, consumption/invalidation state and timestamps. Repeated
registration rotates its UUID and retains the one-hour send budget. Replacement
invalidates the old handle/verifier. Consumed rows await explicit retention.

`app_session`: UUID, user UUID foreign key with cascading deletion, unique
SHA-256 token hash, creation/expiry/revocation timestamps. Raw tokens are 32 random
bytes encoded as base64url. Indexes cover user foreign keys and session/pending
expiry. Email is deliberately not unique.

Registration mutations and login issuance share a transaction-scoped advisory
lock derived from canonical SIS identity, including when no pending row exists.
Existing rows use row locks; uniqueness constraints are the final invariant. Hash
collisions only serialize unrelated identities. Operations share a lock order and
one checked-out pg client. Incorrect OTP errors pass through COMMIT to retain
failed-attempt updates. Unexpected failures roll back/discard failed connections.
Account creation, session creation and pending consumption commit together,
preventing duplicate accounts and successful OTP replay.

Email submission runs outside transactions. A challenge is committed as `sending`,
submitted through the Resend SDK, then conditionally marked `sent` for its exact
id/verifier. The existing database state `sent` means provider acceptance, not
confirmed recipient delivery. Verification rejects `sending`/`failed` codes.
Failures retain cooldown/delivery budget and return the existing safe error.
Stale provider completions cannot activate/invalidate replacements. A crash after
acceptance can leave an unusable code; request another after cooldown. Resend and
PostgreSQL are not atomic. No queue/outbox, delivery webhook or automatic retry is added.

`ResendMailer` preserves `OtpMailer.sendOtp(email, otp): Promise<void>` and the
original plain-text subject/body. The SDK uses an explicit backend key and fixed
HTTPS base URL. Each call gets an AbortSignal deadline covering request and body
consumption (5000 ms by default). Only a no-error result with a nonempty email id
counts as acceptance; malformed responses, SDK exceptions and API errors fail
with a generic exception that the service maps to `503 EMAIL_UNAVAILABLE`.
Provider error bodies and causes are neither logged nor propagated. Startup
rejects SDK debug mode. The SDK uses Node's fetch and owns no SMTP transport or
application-managed connection pool requiring shutdown.

## SIS and sessions

Credentials are sent once to the HTTPS SIS origin's `POST /api/v1/auth/verify`
with a private service bearer key. The adapter rejects redirects, applies a whole
operation deadline and 256 KiB response cap, and validates `data.userId` and
`data.email`. Nested academic fields are accepted but not retained. No extra
member request is made.

Upstream `401 INVALID_CREDENTIALS` maps to an authentication error;
`401 SERVICE_UNAUTHORIZED` maps to service unavailability. Rate limiting,
unavailability and malformed responses have distinct safe codes. Credentials and
upstream text are never logged. Passwords are neither stored nor hashed locally.
Every new login calls SIS. Restoration/other session requests use PostgreSQL.

Bearer checks enforce hash, expiry, revocation, verified email and active
application status. `/me` returns necessary identity and expiry, without a token.
Logout revokes the current session only. Disablement rejects subsequent session
checks. There is no sliding expiry, refresh token, local password, reset or
automatic email linking/replacement. A new SIS email does not silently replace
the address verified during registration.

## HTTP, resources and operational limits

See [authentication](authentication.md) for DTOs and errors. JSON is bounded to
8 KiB with compression disabled and allowlisted fields/types. Responses use
no-store/nosniff; framework identification/ETags are disabled. No cookies, CORS or
proxy trust are enabled. Internal errors log only a generic message.

Fixed-window in-memory limits: 20 register/login requests per IP per 15 minutes,
10 per normalized identifier per 15 minutes, 60 verify/resend requests per IP per
15 minutes and 120 total auth requests per IP per minute. Identifier keys are
hashed. Storage is capped at 10000 entries, reclaims expired entries and fails
closed at capacity. Counters reset on restart; persistent OTP budgets do not.

The unchanged pool accepts loopback only and bounds acquisition/statements/locks
and idle transactions. HTTP retains ten-second header and thirty-second
request-receipt timeouts. Shutdown drains HTTP then closes the database pool under the
existing ten-second deadline. `/health` is liveness, not continuous readiness.

The preserved migration runner checks order/checksums and applies SQL/tracking
transactionally under its existing lock. Applied files are immutable. No
migrations run during startup. No institutional/future-feature tables,
database roles or installation changes are introduced.

Before multi-instance production: shared rate limits, reviewed TLS/proxy/IP
handling, restricted runtime credentials, secret rotation, retention/cleanup and
redacted monitoring. Define cleanup for expired/revoked sessions and pending
registrations. Sessions do not continuously recheck SIS status; they remain valid
until expiry/revocation/application disablement. Hosting, fine-grained permissions,
renewal and background cleanup remain future scoped work.

## Verification

Node's test runner and injected fetch cover configuration/security/HTTP/adapters.
Integration tests create a new random `_test` database, apply the real migration
and exercise real transactions with mocked SIS/email and a controllable clock.
Only that generated database receives destructive fixtures and is dropped later.
No real SIS/Resend credentials are needed. Adapter tests mock HTTPS responses
while exercising the actual SDK, including API rejections, invalid acceptance ids,
network errors and timeouts. The SDK's declarations require development-only React
types and a narrow Node `HeadersInit` alias; no runtime React dependency or broad
TypeScript checking exemption is introduced.

## Official references

Consulted before changing backend code:

- [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html): randomness, HMAC, hashing and timing-safe comparison.
- [Official Node 24 globals source](https://raw.githubusercontent.com/nodejs/node/v24.22.2/doc/api/globals.md): fetch/abort; rendered globals page was inaccessible through the web tool.
- [Node 24 tests](https://nodejs.org/docs/latest-v24.x/api/test.html): built-in runner.
- [Express 5 API](https://expressjs.com/en/5x/api/) and [errors](https://expressjs.com/en/guide/error-handling/): routes, bounded JSON and async errors.
- [TypeScript modules](https://www.typescriptlang.org/docs/handbook/modules/reference.html): NodeNext ESM.
- [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/): dependency/lockfile updates.
- [PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html) and [constraints](https://www.postgresql.org/docs/18/ddl-constraints.html): concurrency/invariants.
- [node-postgres transactions](https://node-postgres.com/features/transactions): one client per transaction.
- [Resend Node quickstart](https://resend.com/docs/send-with-nodejs), [send API](https://resend.com/docs/api-reference/emails/send-email), [errors](https://resend.com/docs/api-reference/errors) and [event types](https://resend.com/docs/webhooks/event-types): SDK submission, failure handling and acceptance versus recipient-server delivery.
- [Official Resend SDK v6.37.0](https://github.com/resend/resend-node/tree/v6.37.0): request cancellation, fixed API origin, debug behavior and published types.
- [TypeScript global declarations](https://www.typescriptlang.org/docs/handbook/declaration-files/templates/global-modifying-module-d-ts.html): narrow Node header-type compatibility without enabling DOM globals.
- [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [verification-token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): unpredictable, expiring, single-use tokens and abuse limits; no password-reset feature is implemented.
