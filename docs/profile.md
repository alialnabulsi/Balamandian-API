# Profiles and university social identity

Implemented on `feature/profile` from local integrated `dev` at `7cec8b6`.
The companion Flutter branch starts at `92382dd`. Both retain marketplace.
Changes are deliberately uncommitted and unpushed. SIS-API is a read-only contract
reference; no SIS code, records, credentials or deployment was changed.

## Ownership and architecture

`src/modules/profile/` separates routes, controllers, strict validators, business
service, PostgreSQL repository, DTOs, avatar normalization and composition.
All endpoints reuse existing hashed bearer-session authentication. Controllers
derive mutation ownership exclusively from the session. Institutional roles do
not grant application administrative privileges.

The shared relational identity remains `app_user.id`. `sis_user_id` and the email
verified by OTP stay in `app_user`, and the real account creation timestamp is read
there. Official first/last names, generated username, bounded roles and selected
academic metadata live in `user_profile`. Display name is derived from official
names. Only biography and avatar are editable. PATCH accepts exactly one field;
requests with official fields are rejected rather than silently ignoring them.

Small academic snapshots preserve multiple student programs and distinct
instructor/advisor departments. Only campus name, admission year, program name,
department name and faculty name are retained. No grades, schedules, enrollment
records, hire dates, passwords or raw SIS responses are copied. These bounded
snapshots use JSONB because the current operation is an owner-only account read;
core identity and relationships use relational columns and indexes.

## Signup and existing accounts

`SisAdapter` validates the actual `POST /api/v1/auth/verify` member contract,
including first/last name, roles and applicable academic subtypes. It retains
existing HTTPS, redirect rejection, deadline, response cap and safe error rules.
The credential response already has all required data: registration makes no
second member request and never stores the SIS password.

Registration stores a selected identity snapshot with its pending challenge.
After a valid OTP, the existing per-SIS advisory lock and checked-out transaction
create the account, profile, unique username and session and mark the challenge
consumed together. Profile errors roll back the complete operation. Existing
resend, delivery, expiry, attempt and rate protections remain. Old pending rows
without a snapshot fail `REGISTRATION_INVALID`: verify credentials and start
registration again; there is no incomplete-account or OTP bypass path.

Every successful SIS login refreshes the profile snapshot transactionally while
preserving the original username, biography, avatar, UUID and verified email.
For a still-valid legacy session, `GET /profile/me` first checks local PostgreSQL.
Only a missing profile triggers service-authenticated `GET /api/v1/members/:sisId`.
The canonical returned ID must match and the member must be active. Hydration
coalesces concurrent requests per user in the process and rechecks under a user
lock in the database, making it idempotent across processes. At most 100 distinct
hydrations run concurrently. SIS failures return recoverable `503
PROFILE_UNAVAILABLE`; they never revoke a valid session. Normal profile reads
do not contact SIS. There is no periodic SIS synchronization in this feature.
Changes to institutional email never silently replace the verified application
address.

## Username policy

Normalize each official name with Unicode NFKD, remove combining marks,
lowercase, then remove everything outside ASCII `a-z0-9`. Whitespace and
punctuation inside compound names are removed. Join nonempty first/last parts
with a period and truncate to 24 characters, removing a trailing period.
`Ali` + `Al Nabulsi` becomes `ali.alnabulsi`; accents decompose predictably.
The base must start with an ASCII letter and have at least three characters.
Otherwise use `member.` plus the first 12 hexadecimal characters of SHA-256 over
NFKC-normalized official first name, a null separator and last name. Non-Latin
names remain intact in display names; this deterministic fallback is used when
the names cannot produce a valid ASCII username. No transliteration library or
guessed romanization is used.

Allocate the base, then suffixes `2`, `3`, etc. (up to `999999`), with a maximum
30-character username. No SIS IDs, emails, UUIDs or private records form collision
suffixes. An advisory lock per base reduces contention; a unique index on
`lower(username)` and `INSERT ... ON CONFLICT DO NOTHING` are the final guarantee,
including collisions between differently normalized bases. Existing usernames
never change on hydration or login. Exhausted capacity fails the transaction.

## API contract

All paths below have the `/api/v1` prefix. All require an active, email-verified
application bearer session. Successful responses are `200`, JSON is wrapped as
`{"data": ...}`, and binary avatar retrieval returns WebP bytes. Request fields,
queries, UUID parameters and page limits are strictly validated. GETs have no
request bodies. Mutations other than PATCH/upload reject bodies.

| Method | Path                       | Input                                                            | Response data                                     |
| ------ | -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| GET    | `/profile/me`              | None                                                             | Owner profile; hydrates legacy identity if needed |
| PATCH  | `/profile/me`              | JSON `{ "biography": "..." }`                                    | Updated owner profile                             |
| PUT    | `/profile/me/avatar`       | Raw JPG/PNG/WebP bytes with matching approved image content type | Updated owner profile                             |
| DELETE | `/profile/me/avatar`       | None                                                             | Updated owner profile                             |
| GET    | `/users`                   | `search`, `page`, `limit`                                        | Member page; excludes viewer                      |
| GET    | `/users/:userId/profile`   | Application UUID                                                 | Public profile, even when requested by owner      |
| GET    | `/users/:userId/avatar`    | Optional UUID `v` from avatarPath                                | `image/webp`, authenticated, no-store             |
| GET    | `/users/:userId/followers` | `search`, `page`, `limit`                                        | Member page                                       |
| GET    | `/users/:userId/following` | `search`, `page`, `limit`                                        | Member page                                       |
| PUT    | `/users/:userId/follow`    | None                                                             | Authoritative target public profile/counts        |
| DELETE | `/users/:userId/follow`    | None                                                             | Authoritative target public profile/counts        |

Public profile fields:

```text
id: application UUID
username, displayName, biography: string
avatarPath: relative API avatar path with version UUID, or null
verified: boolean (confirmed SIS identity)
roles: string[] (approved broad student/instructor/advisor/staff roles only)
postsCount: 0 (community posts do not exist yet)
followersCount, followingCount: nonnegative integer
isFollowing, isSelf: boolean relative to the authenticated viewer
```

Owner profiles add `account`:

```text
firstName, lastName, sisId, institutionalEmail: string
createdAt, emailVerifiedAt: ISO UTC timestamp from app_user
institutionalRoles: bounded string[] (including other SIS roles, owner-only)
academic:
  campus: string | null
  admissionYear: integer | null
  programs: [{ name, department, faculty }]
  departments: [{ name, faculty }]
```

Public DTO projection never includes `account`, SIS identifiers, email, detailed
academics, creation timestamps, OTPs or session information. Member discovery
and both social lists use exactly the public projection, with no avatar bytes.

Member pages: `{items: PublicProfile[], page, limit, total, hasMore}`. Defaults
are page 1/limit 20; maximum limit 50 and page 1,000,000. Search is a literal,
case-insensitive name/username substring, at most 100 characters; one leading
`@` is accepted. Ordering is username then UUID. A CTE returns page and total
from one statement snapshot, including empty pages. It uses set-based correlated
SQL, without per-member service/database round trips. Clients reset to page 1
when the search changes. Offset pagination is deterministic for a stable set;
live additions/removals between pages can shift results.

Errors retain `{error:{code,message}}`. Important status/code pairs:

- `400 VALIDATION_ERROR`, `SELF_FOLLOW`, `AVATAR_INVALID`, `INVALID_JSON`.
- `401 UNAUTHENTICATED`: uses the existing session recovery boundary.
- `404 PROFILE_NOT_FOUND`: missing/disabled account, missing profile or avatar.
- `413 REQUEST_TOO_LARGE`; `415 UNSUPPORTED_MEDIA_TYPE`.
- `429 RATE_LIMITED` with Retry-After.
- `503 PROFILE_UNAVAILABLE`: recoverable legacy identity hydration failure.

Read and mutation budgets are separate per application UUID: 300 total profile
requests/minute and 60 mutations/15 minutes. Bounded process-local maps reclaim
expired entries and fail closed at capacity. Authentication runs first. A shared
limiter is still needed for multi-instance production, consistent with the
existing authentication and marketplace limitations.

## Avatars and social constraints

The PostgreSQL repository owns one avatar per profile in `user_avatar`; its
methods are the storage boundary for a future object-store implementation.
Upload accepts up to 1,000,000 bytes of JPEG/PNG/WebP. Sharp 0.35.5 checks actual
decoded format, single-frame content, input pixel bounds and maximum 4096 pixels
per side. SVG, unsupported formats, malformed/truncated files and animation are
rejected. Images auto-orient, resize/crop within 512×512 and re-encode to WebP;
metadata is stripped by default. The database separately bounds stored bytes.
Replacement updates one row and rotates its UUID version, deletion removes it,
and cascades prevent orphan rows. Ordinary JSON contains a versioned relative
reference only. All retrievals still authenticate; responses use no-store and
nosniff. Flutter validates the fixed relative route and fetches bytes through its
existing session boundary, never attaching bearer headers to external URLs.

`user_follow` uses `(follower_id,following_id)` as its primary key, has a
self-follow CHECK and cascading application UUID foreign keys, and indexes the
reverse direction. Follow/unfollow are idempotent and serialize participant user
locks in UUID order to prevent opposite-direction deadlocks. Disabled/unavailable
targets cannot be followed and are excluded from public counts/lists. Mutation
responses calculate authoritative target counts inside the transaction. Flutter
then refreshes the owner's following count. No posts, message, achievement,
notification, block or approval tables are added.

## Database synchronization and verification

`database/migrations/0003_user_profile.sql` is the only new migration. It adds
`pending_registration.identity_snapshot`, `user_profile`, `user_avatar` and
`user_follow`, with uniqueness, foreign keys, length and size constraints.
The original runner remains authoritative and checksums applied SQL. Do not edit
an applied migration. Coordinate numbering before integrating another developer's
new migration; resolve conflicts through a forward migration.

After receiving the reviewed feature (no commit/push is performed by this task),
both developers use their own ignored local configuration:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24.22.2
npm ci
npm run db:migrate
npm run check
npm test
node --env-file-if-exists=.env --test test/integration/*.test.js
```

This works for both an empty database (0001→0002→0003) and an existing
authentication/marketplace database. No seed or reset is needed for real
accounts; profiles hydrate from verified SIS on login or owner request. Automated
tests use fictional identities and newly generated `_test` databases and mock
SIS/email; they never send real OTPs or change hosted SIS records.

On 2026-11-20, the target was verified as `127.0.0.1:5433/balamandian` before
applying 0003 through the original runner. Counts before/after were identical:
2 users, 11 sessions, 0 marketplace favorites, 0 ratings. A repeat migration
returned an empty applied list. Existing migration files were unchanged.

Tests cover the upgrade with an existing account/session, atomic OTP rollback,
snapshot signup, legacy pending rejection, concurrent duplicate names,
multi-role SIS parsing, recoverable hydration, unchanged verified email,
strict owner mutations, public privacy, avatar lifecycle and social pagination.
See the companion Flutter `Docs/profile.md` for manual device verification.

Verification on 2026-11-20: 39 unit/HTTP tests and 40 isolated integration tests
passed (the integration total includes parent scenarios). Typechecking, ESLint,
Prettier and `git diff --check` passed. The upgrade scenario preserves existing
fictional favorites and a rating, in addition to the account and session. After
adding those upgrade assertions, the affected auth/profile integration suites
passed all 28 scenarios; the unchanged marketplace suite had already passed.

## Official references and limits

Consulted current official [Node 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html),
[Express 5](https://expressjs.com/en/5x/api/),
[TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html),
[PostgreSQL INSERT](https://www.postgresql.org/docs/18/sql-insert.html),
[node-postgres transactions](https://node-postgres.com/features/transactions),
and [Sharp constructor and input limits](https://sharp.pixelplumbing.com/api-constructor/).
The selected locking, normalization, metadata and storage policies are project
decisions, not claims that the frameworks require them.

Live SIS availability, real Resend delivery and physical gallery/clipboard
behavior require manual verification. PostgreSQL avatars suit the bounded local
senior-project environment; object storage, retention and shared rate limits
remain deployment concerns. Profile refresh is explicit/pull-to-refresh, not
real-time. Institution changes refresh on successful login. Messaging, community
posts and native profile deep links remain unimplemented. Biography and avatar
save through explicit separate endpoints; the client reports a partial avatar
success if a later biography save fails.
