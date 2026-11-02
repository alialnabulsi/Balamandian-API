# Authentication HTTP contract

Base path: `/api/v1/auth`. All examples below contain fictional identity data,
timestamps, UUIDs and credentials. Use HTTPS at the deployment boundary; local
development binds to loopback HTTP. Send JSON with `Content-Type: application/json`.
Bodies are limited to 8 KiB; compression, extra fields and incorrect types are
rejected. Passwords are forwarded exactly as supplied and never retained.

## Register

`POST /api/v1/auth/register`

```json
{ "identifier": "FICTION001", "password": "example-password" }
```

The identifier may instead be the institutional email. SIS is verified first;
the email destination is always the SIS-provided address, never client-supplied.
After Resend accepts the email submission, return **202**:

```json
{
  "data": {
    "pendingRegistrationId": "0b3b97c7-c8fd-44b0-b013-cdbd9cf735f0",
    "otpExpiresAt": "2026-11-02T10:10:00.000Z",
    "resendAvailableAt": "2026-11-02T10:01:00.000Z"
  }
}
```

This response contains no session, account, OTP or email address. No active
application account exists until successful verification. Existing application
accounts return `409 ACCOUNT_EXISTS` after successful SIS verification.

Repeated registration within sixty seconds returns `429 OTP_COOLDOWN`. Eligible
replacement rotates the pending id and code while preserving the original
one-hour delivery budget. Old handles stop working. After the one-hour window,
a new credential-verified registration resets the budget.

## Verify email

`POST /api/v1/auth/register/verify`

```json
{
  "pendingRegistrationId": "0b3b97c7-c8fd-44b0-b013-cdbd9cf735f0",
  "otp": "004281"
}
```

The OTP is a six-character numeric string, including leading zeroes. Successful
verification returns **201**, atomically creating the account, consuming the
challenge and creating a session:

```json
{
  "data": {
    "user": {
      "id": "11111111-1111-4111-8111-111111111111",
      "sisUserId": "FICTION001",
      "institutionalEmail": "member@example.edu",
      "emailVerifiedAt": "2026-11-02T10:02:00.000Z"
    },
    "session": {
      "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "tokenType": "Bearer",
      "expiresAt": "2026-11-09T10:02:00.000Z"
    }
  }
}
```

The illustrative token above is a placeholder, not a real session. Real tokens
have 32 random bytes of entropy and are returned only at issuance. Concurrent
correct requests produce one account/session; subsequent attempts cannot replay
the OTP.

## Resend

`POST /api/v1/auth/register/resend`

```json
{ "pendingRegistrationId": "0b3b97c7-c8fd-44b0-b013-cdbd9cf735f0" }
```

After cooldown, accepted delivery returns **202**, retaining the pending id:

```json
{
  "data": {
    "pendingRegistrationId": "0b3b97c7-c8fd-44b0-b013-cdbd9cf735f0",
    "otpExpiresAt": "2026-11-02T10:11:00.000Z",
    "resendAvailableAt": "2026-11-02T10:02:00.000Z"
  }
}
```

The previous code immediately becomes unusable, and failed attempts reset for
the newly issued code. Allowance is three resends, in addition to the original
delivery, per one-hour registration window. Credential-based replacement requests
consume this same allowance. Failed provider submissions also consume the reserved budget
and cooldown to avoid retry-based abuse. Codes expire in ten minutes, capped by
the original registration window's expiry; they never extend that window. After
window expiry, submit credentials through `/register` again.

## Login

`POST /api/v1/auth/login`

```json
{ "identifier": "member@example.edu", "password": "example-password" }
```

The equivalent SIS-id request is:

```json
{ "identifier": "FICTION001", "password": "example-password" }
```

Every new login calls SIS, then finds the application user by canonical SIS id.
Missing, unverified and disabled accounts are rejected. Successful login returns
**200**, using exactly the same `data.user` and `data.session` shape as verification:

```json
{
  "data": {
    "user": {
      "id": "11111111-1111-4111-8111-111111111111",
      "sisUserId": "FICTION001",
      "institutionalEmail": "member@example.edu",
      "emailVerifiedAt": "2026-11-02T10:02:00.000Z"
    },
    "session": {
      "token": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "tokenType": "Bearer",
      "expiresAt": "2026-11-09T11:00:00.000Z"
    }
  }
}
```

## Restore session

`GET /api/v1/auth/me`

```http
Authorization: Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
```

No body. Successful response **200**:

```json
{
  "data": {
    "user": {
      "id": "11111111-1111-4111-8111-111111111111",
      "sisUserId": "FICTION001",
      "institutionalEmail": "member@example.edu",
      "emailVerifiedAt": "2026-11-02T10:02:00.000Z"
    },
    "session": { "expiresAt": "2026-11-09T11:00:00.000Z" }
  }
}
```

Restoration does not return or renew the raw token and makes no SIS request.
Every protected request checks session expiry/revocation and current application
account status. Existing sessions remain usable during SIS outages.

## Logout

`POST /api/v1/auth/logout`

```http
Authorization: Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
```

No body. Success is **204**, with an empty response body. The current database
session is revoked; other sessions remain valid. Reusing that token, including
for another logout, returns `401 UNAUTHENTICATED`.

Sessions initially last seven days, configurable with
`SESSION_LIFETIME_SECONDS`. Only SHA-256 token hashes are stored in PostgreSQL.
There is no refresh token, sliding renewal or local password. After expiry,
perform a new SIS-backed login. The client should store its token using suitable
platform-protected storage and send it only to this backend over HTTPS.

## Errors and limits

Every application error uses this shape; supplied credentials, SQL details and
upstream messages are never echoed:

```json
{
  "error": {
    "code": "OTP_EXPIRED",
    "message": "The verification code has expired. Request a new code."
  }
}
```

| HTTP | Code                                                  | Meaning                                                                                 |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_REQUEST` | Invalid fields, JSON or incomplete body.                                                |
| 400  | `REGISTRATION_INVALID`                                | Unknown, consumed, invalidated, replaced or window-expired registration handle.         |
| 400  | `OTP_INVALID`                                         | Incorrect code; failed attempt is committed persistently.                               |
| 401  | `SIS_INVALID_CREDENTIALS`                             | SIS rejected the institutional credentials.                                             |
| 401  | `UNAUTHENTICATED`                                     | Missing, malformed, expired, revoked or otherwise unusable bearer session.              |
| 403  | `REGISTRATION_REQUIRED`                               | SIS identity has no application account.                                                |
| 403  | `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED`              | Existing application account is unverified/disabled.                                    |
| 404  | `NOT_FOUND`                                           | Unknown route.                                                                          |
| 409  | `ACCOUNT_EXISTS`                                      | Registration conflicts with an existing application account.                            |
| 409  | `OTP_UNAVAILABLE`                                     | Email submission has not been accepted successfully.                                    |
| 409  | `REGISTRATION_REPLACED`                               | A stale email completion belongs to a replaced challenge.                               |
| 410  | `OTP_EXPIRED`                                         | Code expired; resend within the registration window.                                    |
| 413  | `REQUEST_TOO_LARGE`                                   | JSON exceeds 8 KiB.                                                                     |
| 415  | `UNSUPPORTED_MEDIA_TYPE`                              | JSON/UTF-8 required; compressed requests are disabled.                                  |
| 429  | `OTP_ATTEMPT_LIMIT`                                   | Five failed attempts on this code; request a new code subject to send limits.           |
| 429  | `OTP_COOLDOWN`, `OTP_RESEND_LIMIT`                    | Persistent sixty-second cooldown or delivery budget exhausted.                          |
| 429  | `RATE_LIMITED`                                        | Local process abuse counter exceeded.                                                   |
| 429  | `SIS_RATE_LIMITED`                                    | Remote SIS rate limit.                                                                  |
| 502  | `SIS_INVALID_RESPONSE`                                | Malformed, oversized or unexpected SIS response.                                        |
| 503  | `SIS_UNAVAILABLE`                                     | Network/timeout/upstream failure, including invalid backend service credentials.        |
| 503  | `EMAIL_UNAVAILABLE`                                   | Email submission failed, including provider rejection or timeout. Retry after cooldown. |
| 500  | `INTERNAL_ERROR`                                      | Unexpected failure without internal details.                                            |

Cooldown/budget/process-rate errors include a bounded `Retry-After` duration in
seconds; SIS rate errors use a safe sixty-second backoff. Five failed attempts
lock that issued code, including a subsequent correct submission. Resend is
available subject to cooldown and remaining allowance. Responses carry no-store
and nosniff headers; authentication errors carry `WWW-Authenticate: Bearer`.

Process-local limits are 20 register/login requests per IP per fifteen minutes,
10 per normalized identifier per fifteen minutes, 60 OTP verify/resend requests
per IP per fifteen minutes, and 120 total auth requests per IP per minute. These
limits reset on restart; PostgreSQL OTP budgets do not. Shared rate limiting and
reviewed proxy trust are required before multiple application instances.

## Delivery and configuration boundaries

The OTP verifier is HMAC-SHA-256 keyed by private `OTP_SECRET` and bound to its
opaque registration id. No plaintext OTP/password/session token is stored or
logged. Email uses the official Resend Node SDK exclusively, submitting the
unchanged plain-text subject and message to `https://api.resend.com`.

Required email settings are `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, a single
mailbox on your verified Resend domain. `RESEND_TIMEOUT_MS` defaults to 5000 and
accepts 1–15000 milliseconds. Missing/invalid configuration fails startup. Keep
`RESEND_DEBUG` unset or false; enabling SDK error-body logging is rejected.
The API destination is fixed even if `RESEND_BASE_URL` is set. No SMTP settings,
local capture transport, console OTP mode or fallback provider are used.

The adapter requires an error-free SDK result with a nonempty email id. API-key,
sender/domain, quota and rate-limit errors, outages, malformed responses, network
exceptions and timeouts all retain `503 EMAIL_UNAVAILABLE`; provider bodies and
exception causes are discarded. Each request has an abort deadline including body
consumption and is not automatically retried. A timeout can be ambiguous if the
provider accepted the email before the response was lost. The challenge still
fails safely, consumes its existing cooldown/budget and requires a new request.

The existing database `sent` state means provider acceptance only. It does not
confirm recipient delivery, inbox placement or that the user read the message.
Resend reports later recipient-server delivery, bounce and other events separately;
see [Resend's event definitions](https://resend.com/docs/webhooks/event-types).
Use its dashboard for those statuses; delivery webhooks are not implemented here.
Registration still returns a pending id after acceptance and creates an account
only after successful OTP verification. No endpoint contract changes.

There is no atomic transaction between Resend and PostgreSQL: a crash or database
error after provider acceptance can leave an emailed code unusable. Such a
request never reports success; retry after cooldown. Automated tests mock provider
responses and never send real email. Manual registration with configured local
credentials uses the same real Resend API as a future production instance.

See [README configuration](../README.md#configuration) for required variables and
[architecture](architecture.md) for database constraints, cleanup requirements
and current production limits. Real SIS and Resend smoke tests require the actual
private keys, HTTPS access and verified sender; mocked test success is
not a live integration claim.
