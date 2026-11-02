# Resend email integration report

Resend is now the sole authentication email provider, using the official
`resend@6.37.0` Node SDK over HTTPS. The existing `OtpMailer` interface and
constructor/factory injection remain intact. No authentication endpoint contracts,
OTP policies, SIS verification, session rules, database tables or migrations changed.

## Dependencies

- Installed exact runtime dependency `resend@6.37.0` (supports Node 20+, compatible
  with this project's Node 24.22.2).
- Installed exact development dependency `@types/react@19.3.0`, required by the
  SDK's published declarations even when only sending plain-text messages.
- Removed `nodemailer@10.3.1` and `@types/nodemailer@8.0.2`.
- Updated the npm lockfile with the dependency changes. No React runtime or email
  rendering package is installed. A narrow declaration maps the SDK's missing
  global `HeadersInit` to Node's existing fetch header type. Strict library
  checking and the existing server-only TypeScript configuration remain enabled.

## Environment and startup

Required email settings:

```dotenv
RESEND_API_KEY=
RESEND_FROM_EMAIL=no-reply@example.edu
```

Supply the private real sending key and a single mailbox on your Resend-verified
domain. The sender above is an example, not a configured real sender. Do not use a
display name or surrounding angle brackets in `RESEND_FROM_EMAIL`.

Optional `RESEND_TIMEOUT_MS` defaults to 5000 and accepts 1–15000 milliseconds.
`RESEND_DEBUG=true` is rejected because SDK errors can contain sensitive data.
The adapter explicitly fixes its destination to `https://api.resend.com`, so
`RESEND_BASE_URL` cannot redirect credentials/message contents.

All existing required database, SIS and OTP variables remain: `PGDATABASE`,
`PGUSER`, `PGPASSWORD`, `SIS_BASE_URL`, `SIS_SERVICE_API_KEY`, and `OTP_SECRET`.
Keep the local `PGHOST`/`PGPORT` pointing to PostgreSQL 18 on port 5433. Existing
optional bind, pool, SIS timeout and session settings are unchanged; see the
[complete configuration table](../README.md#configuration). `SMTP_*` variables
are no longer consumed and were removed from the example configuration.

The local ignored `.env` already contains Resend variables, but its current
`RESEND_FROM_EMAIL` fails the single-mailbox validation. Correct this setting
before starting the backend. Its value and the API key were not printed or
modified. With a temporary fictional sender supplied only to the smoke check,
the remaining real local settings validated and the app/database checks passed.
No successful real email delivery or provider authentication is claimed.

## Submission and failure handling

The subject and plain-text OTP message are unchanged. The adapter submits through
`resend.emails.send` with an abort signal covering the request and response body.
Only an error-free SDK result containing a nonempty email id counts as provider
acceptance. API errors, rate limits, invalid sender/key responses, malformed
responses, network failures, thrown exceptions and timeouts all reject safely.
Provider bodies and exception causes are discarded, and no key, code or sensitive
message data is logged. Requests are not automatically retried.

The unchanged application service maps submission failures to the existing
`503 EMAIL_UNAVAILABLE` response, marks the reserved challenge failed and retains
its cooldown/send budget. Registration and resend use the same rules as before.
An ambiguous timeout can occur after provider acceptance; the challenge still
fails safely. A stale completion cannot activate a replacement, and no active
account is created before OTP verification.

The existing database `sent` state means provider acceptance, not confirmed
delivery, inbox placement or readership. Resend reports recipient-server delivery
and bounce events separately; the dashboard can show later status. Delivery
webhooks and schema changes are outside this task. Local manual registration with
valid credentials submits real email; automated tests always mock the provider.
There is no SMTP fallback or local delivery bypass.

## Verification

- `npm run check`: typecheck, ESLint with zero warnings and formatting passed.
- `npm test`: one build and all 22 database-independent tests passed, including
  eight Resend tests using mocked SDK/HTTPS responses. Coverage includes the exact
  message/request, fixed destination, safe API/network errors, malformed results,
  no retries, request/body deadlines, late acceptance and no provider error logs.
- `node --env-file=.env --test test/integration/*.test.js`: all 19 PostgreSQL
  scenarios passed (20 Node runner entries including the parent). The added
  Resend scenario verifies failed registration and resend, the same public error,
  persistent limits, acceptance state and absence of premature account creation.
- Temporary test databases were removed; read-only inspection found none left.
  No development schema migration or destructive development fixture was run.
- With the temporary fictional sender override, local HTTP composition,
  PostgreSQL version verification, `/health` 200 and unauthenticated `/me` 401
  passed. No live SIS or Resend requests were made.
- `git diff --check` passed. Database/migration, SIS, session middleware/security,
  route/controller and shared authentication type files have no changes.
- Stale ignored compiled SMTP adapter output was removed.

The existing npm audit still reports 11 moderate development lint dependency
entries; no forced dependency override was applied.

## Files

Created:

- `src/integrations/email/resend.adapter.ts`
- `src/integrations/email/resend-node.d.ts`
- `test/resend.test.js`
- `docs/resend-integration.md`

Removed:

- `src/integrations/email/smtp.adapter.ts`

Modified:

- `src/config/auth.ts`
- `src/modules/auth/auth.composition.ts`
- `src/modules/auth/auth.repository.ts` (provider-neutral comment only)
- `src/modules/auth/auth.service.ts` (provider-neutral comment only)
- `src/server.ts` (remove SMTP cleanup; update safe configuration message)
- `test/auth.test.js`
- `test/integration/auth.test.js`
- `package.json`
- `package-lock.json`
- `.env.example`
- `README.md`
- `docs/authentication.md`
- `docs/architecture.md`
- `docs/local-database-setup.md`
- `docs/authentication-implementation-report.md` (mark original SMTP report historical)

Changes remain unstaged/uncommitted on `dev`: 15 modified files, one removed file
and four new files. No deployment, commit or push was performed. `.env` remains
ignored and unchanged.

## Official sources consulted

- [Resend Node quickstart](https://resend.com/docs/send-with-nodejs) and
  [send-email API](https://resend.com/docs/api-reference/emails/send-email): SDK,
  required key/sender and successful submission response.
- [Resend errors](https://resend.com/docs/api-reference/errors): unsuccessful API responses.
- [Resend event types](https://resend.com/docs/webhooks/event-types): successful API
  acceptance and later recipient-server delivery are separate events.
- [Official SDK v6.37.0 source](https://github.com/resend/resend-node/tree/v6.37.0):
  abort support, base URL override, debug logging and published declarations.
- [Official Node 24 globals source](https://raw.githubusercontent.com/nodejs/node/v24.22.2/doc/api/globals.md):
  AbortSignal timeout; the rendered globals page was inaccessible through the web tool.
- [TypeScript global declarations](https://www.typescriptlang.org/docs/handbook/declaration-files/templates/global-modifying-module-d-ts.html)
  and [library configuration](https://www.typescriptlang.org/tsconfig/lib.html):
  narrow header-type compatibility while preserving the server-only type environment.
