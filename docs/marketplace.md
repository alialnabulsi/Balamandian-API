# Marketplace HTTP contract

Base path: `/api/marketplace` (no `/v1`). Every endpoint requires
`Authorization: Bearer <application-session-token>`. The existing authentication
module checks expiry, revocation, verified email and active application status on
every request. Marketplace never calls SIS or Resend. Ownership always comes
from the authenticated internal `app_user.id`; clients cannot supply an owner.
See [authentication](authentication.md) for obtaining a session.

All successful responses are HTTP **200** and wrapped in `{ "data": value }`.
Responses have `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
UUIDs and timestamps below are fictional examples. Nullable image URLs are valid.
No archive, internal timestamp or search-vector fields are exposed.

## Endpoints

| Method | Path                        | Behavior                                               |
| ------ | --------------------------- | ------------------------------------------------------ |
| GET    | `/categories`               | Active categories.                                     |
| GET    | `/places`                   | Active places, search, category filter and pagination. |
| GET    | `/places/:placeId`          | Active place detail with images and opening hours.     |
| GET    | `/posts`                    | Currently visible news and advertisements.             |
| PUT    | `/places/:placeId/favorite` | Add or preserve this user's favorite. No body.         |
| DELETE | `/places/:placeId/favorite` | Remove this user's favorite if present. No body.       |
| PUT    | `/places/:placeId/rating`   | Create or replace this user's rating. JSON required.   |
| DELETE | `/places/:placeId/rating`   | Remove this user's rating if present. No body.         |

All `placeId` route parameters must be canonical hyphenated UUIDs (hexadecimal
case is accepted and normalized). Unknown query parameters, repeated keys/arrays,
nested values and invalid types are rejected. Categories, detail and mutations
accept no query parameters. Favorite and delete requests reject supplied bodies.

## Categories

`GET /categories` has no query parameters. Only active categories are returned,
ordered by `sort_order ASC, name ASC, id ASC`.

```json
{
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Fictional Goods",
      "slug": "fictional-goods",
      "iconKey": "shop",
      "sortOrder": 10
    }
  ]
}
```

## Places and search

`GET /places` accepts these optional parameters:

| Parameter  | Rules                                                                                                                           | Default        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `search`   | Trimmed text, 1–100 characters, no control characters. Whitespace-only is invalid.                                              | No search      |
| `category` | Exact active category slug, up to 80 characters, lowercase alphanumeric words separated by single hyphens.                      | All categories |
| `page`     | Positive decimal safe integer. Offset must also be a safe integer. No signs, leading zeros, fractions, exponents or whitespace. | `1`            |
| `limit`    | Decimal integer, 1–50, same strict number syntax.                                                                               | `20`           |

Search is case-insensitive across name, full description, address, category name
and category slug. It combines the existing simple-language `search_document`
with literal substring matching. SQL wildcards in input remain literal; all
values are parameterized. Both place and category must be active. An unknown or
archived category slug returns an empty page, never a category 404.

Order: this user's favorites first, then exact unrounded average rating
descending, place name ascending and place UUID ascending. Display averages are
JSON numbers rounded to one decimal, or `0` without ratings. Counts are JSON
integers; `myRating` is this user's integer rating or null.

```json
{
  "data": {
    "items": [
      {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "Fictional Observatory Store",
        "slug": "fictional-observatory-store",
        "description": "The full fictional place description.",
        "coverImageUrl": null,
        "address": "42 Fictional Lane",
        "category": {
          "id": "11111111-1111-4111-8111-111111111111",
          "name": "Fictional Goods",
          "slug": "fictional-goods",
          "iconKey": "shop"
        },
        "averageRating": 0,
        "ratingCount": 0,
        "myRating": null,
        "isFavorite": false
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

`totalPages = ceil(totalItems / limit)`, including `0` for no matches.
`hasNextPage = page < totalPages`; `hasPreviousPage = page > 1`. An out-of-range
page returns empty items with the exact filtered total. Totals and page items
share one statement snapshot. Separate HTTP requests may see changed ordering
when favorites, ratings or catalog data change; offset pagination is deterministic
for unchanged data, not a snapshot spanning multiple requests.

## Place detail

`GET /places/:placeId` returns the complete summary plus these detail fields.
Coordinates are JSON numbers or null, never PostgreSQL numeric strings.

```json
{
  "data": {
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Fictional Observatory Store",
    "slug": "fictional-observatory-store",
    "description": "The full fictional place description.",
    "coverImageUrl": null,
    "address": "42 Fictional Lane",
    "category": {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Fictional Goods",
      "slug": "fictional-goods",
      "iconKey": "shop"
    },
    "averageRating": 0,
    "ratingCount": 0,
    "myRating": null,
    "isFavorite": false,
    "latitude": null,
    "longitude": null,
    "googleMapsUrl": null,
    "phoneNumber": null,
    "websiteUrl": null,
    "socialUrl": null,
    "timezone": "Asia/Beirut",
    "images": [
      {
        "id": "33333333-3333-4333-8333-333333333333",
        "imageUrl": "https://example.invalid/store.jpg",
        "alternativeText": "Storefront",
        "sortOrder": 0
      }
    ],
    "openingHours": [
      { "dayOfWeek": 1, "opensAt": "07:30", "closesAt": "20:00" }
    ]
  }
}
```

Images order by `sort_order ASC, id ASC`; `alternativeText` may be null. Hours
order by `day_of_week ASC, opens_at ASC, closes_at ASC, id ASC`. Days use ISO
1 (Monday) through 7 (Sunday); times are local `HH:mm` in the place's timezone.
Split intervals are retained. An interval ending before it opens crosses midnight
as permitted by the schema. No row for a day means closed; empty images/hours are
`[]`. No `isOpenNow` is calculated. Detail reads use a repeatable-read snapshot
across the place and independent child queries, preventing duplicate children or
multiplied rating counts. An unknown place, archived place or place in an archived
category returns `404 PLACE_NOT_FOUND`.

## News and advertisements

`GET /posts` accepts:

| Parameter | Rules                                                         | Default            |
| --------- | ------------------------------------------------------------- | ------------------ |
| `type`    | Exactly `news` or `advertisement`.                            | Both types         |
| `placeId` | Hyphenated UUID. Unknown/archived places yield an empty page. | All visible places |
| `page`    | Same positive integer/offset rules as places.                 | `1`                |
| `limit`   | Same 1–50 rules as places.                                    | `20`               |

The post, its place and its category must all be unarchived. Visibility uses an
injected server clock: `starts_at <= now` and `ends_at IS NULL OR ends_at > now`.
The start is inclusive; the end is exclusive. No background job is required.
Order: this user's favorite-place posts first, `starts_at DESC`, post UUID DESC.
Pagination semantics match places. All response timestamps are ISO 8601 UTC.

```json
{
  "data": {
    "items": [
      {
        "id": "44444444-4444-4444-8444-444444444444",
        "type": "news",
        "title": "Fictional seasonal selection",
        "body": "Complete fictional post body.",
        "imageUrl": null,
        "startsAt": "2026-01-01T00:00:00.000Z",
        "endsAt": null,
        "isFavoritePlace": true,
        "place": {
          "id": "22222222-2222-4222-8222-222222222222",
          "name": "Fictional Observatory Store",
          "slug": "fictional-observatory-store",
          "coverImageUrl": null
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

## Favorites

`PUT /places/:placeId/favorite` has no JSON body. It confirms an active place and
inserts with `ON CONFLICT DO NOTHING`. Repetition is successful without duplicates:

```json
{
  "data": {
    "placeId": "22222222-2222-4222-8222-222222222222",
    "isFavorite": true
  }
}
```

`DELETE /places/:placeId/favorite` confirms the same active-place condition and
removes only this user's row, including when it is already absent:

```json
{
  "data": {
    "placeId": "22222222-2222-4222-8222-222222222222",
    "isFavorite": false
  }
}
```

## Ratings

`PUT /places/:placeId/rating` requires `Content-Type: application/json`, UTF-8,
uncompressed strict JSON up to 8 KiB. Accept exactly one field, an integer 1–5:

```json
{ "rating": 4 }
```

This creates or replaces the user's one rating for that place; replacement
updates `updated_at`, retaining `created_at`. Timestamps never move backwards
if requests arrive in a different order from their captured clocks. It does not append another rating.
Statistics reflect the committed write and all users' ratings:

```json
{
  "data": {
    "placeId": "22222222-2222-4222-8222-222222222222",
    "myRating": 4,
    "averageRating": 4,
    "ratingCount": 1
  }
}
```

`DELETE /places/:placeId/rating` has no body, removes only this user's rating and
returns statistics after deletion. Repetition succeeds; remaining other-user
ratings still contribute. When none remain:

```json
{
  "data": {
    "placeId": "22222222-2222-4222-8222-222222222222",
    "myRating": null,
    "averageRating": 0,
    "ratingCount": 0
  }
}
```

All mutations require an active place/category. One checked-out client holds a
transaction, locks the place against concurrent feature mutations and the category
against archival, performs the write/delete and reads rating statistics before
commit. Database primary keys enforce ownership uniqueness. Reads aggregate
ratings independently of images, hours and posts.

## Errors and limits

Errors retain the existing safe envelope, for example:

```json
{
  "error": {
    "code": "PLACE_NOT_FOUND",
    "message": "This place is unavailable."
  }
}
```

| HTTP | Code                     | Meaning                                                                                                                     |
| ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`       | Invalid route UUID, query, body fields or forbidden body.                                                                   |
| 400  | `INVALID_JSON`           | Malformed or non-object/array strict JSON parser input. Arrays parsed successfully are rejected by rating field validation. |
| 400  | `INVALID_REQUEST`        | Aborted or incomplete body, from existing parser handling.                                                                  |
| 401  | `UNAUTHENTICATED`        | Missing, malformed, expired, revoked or disabled application session. Includes `WWW-Authenticate: Bearer`.                  |
| 404  | `PLACE_NOT_FOUND`        | Unknown/archived place or archived category on detail/mutations.                                                            |
| 404  | `NOT_FOUND`              | Unknown route.                                                                                                              |
| 413  | `REQUEST_TOO_LARGE`      | Rating JSON exceeds 8 KiB.                                                                                                  |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Rating JSON content type/UTF-8 required; compressed bodies disabled.                                                        |
| 429  | `RATE_LIMITED`           | Marketplace mutation budget or limiter storage capacity exceeded.                                                           |
| 500  | `INTERNAL_ERROR`         | Unexpected error; SQL, credentials and stack traces are never exposed.                                                      |

Session authentication runs before mutation rate limiting, parsing and validation.
The process-local limiter keys exclusively by internal user UUID, permits 60
marketplace mutations per 15-minute fixed window shared across all four mutation
routes, caps storage at 10,000 users, reclaims expired entries and fails closed
for new users when full. Invalid authenticated mutation attempts also consume the
budget. Reads do not consume it. A 429 includes `Retry-After` bounded to 1–900
seconds and a safe marketplace-specific message. Counters reset on restart.
**Shared rate limiting is required before multi-instance production.**

## Images and deferred behavior

Database cover/post image URLs remain supported and may be null. Gallery image
rows, when present, contain the schema-required HTTPS URL. The initial Flutter
client supplies its own local placeholder when a URL is null; the backend does
not manufacture a URL or insert dummy data. No Flutter changes are included.

Administration/CRUD, image uploads, object storage, comments, open-now computation,
map-provider integration and any new SIS/email behavior are explicitly deferred.
No migration or development-seed modification is required for this module.

## Verification and references

`test/marketplace.test.js` uses Node's test runner with injected dependencies and
native HTTP. `test/integration/marketplace.test.js` creates a generated
`balamandian_market_<uuid>_test` PostgreSQL 18 database, applies both real migrations,
inserts fictional fixtures and drops only that database. It never uses the
local development data, calls SIS or sends email. The authentication integration
suite similarly uses its own generated database and still runs in full.

Official documentation consulted for the implementation is recorded in
[architecture](architecture.md#official-references), including Express 5 async
errors/JSON parsing, node-postgres parameterization and transactions, PostgreSQL 18
locking, upserts, text search and snapshots, and Node 24's built-in test runner.
