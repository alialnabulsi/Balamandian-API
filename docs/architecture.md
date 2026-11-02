# Approved backend architecture

Status: approved architecture; HTTP and local PostgreSQL foundation source.
Database dependency installation and runtime verification await the required local
Node/PostgreSQL setup documented in README.md.

## Deployment and technology

Balamandian-API is a modular monolith: one deployable application whose features
have explicit internal boundaries. Use Node.js LTS, Express 5, strict TypeScript,
and ESM. PostgreSQL 18 is the local application database target.
The current Node 24 toolchain is documented in the root README.

This keeps deployment and transactions straightforward while allowing modules to
grow independently. Additional services, queues, caches, or infrastructure need
concrete requirements before introduction. Keep future request handling free of
instance-local authoritative state so deployment can scale to multiple instances.

These organizational conventions are project decisions. Express does not
prescribe this folder structure or require TypeScript.

## System responsibilities

| System                          | Owns                                                                                                          | Boundary                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Flutter application             | User interface and client interaction                                                                         | Calls Balamandian-API; never receives SIS service credentials or direct database access.       |
| Balamandian-API                 | Application data, business rules, application authorization, and future application identity/session handling | Serves the mobile app; accesses SIS through its HTTP API when approved functionality needs it. |
| SIS-API                         | Institutional credential verification and permitted member retrieval                                          | Institutional source of truth; retains its own database and credentials.                       |
| Application PostgreSQL database | Persistent application-owned state                                                                            | Separate from SIS's database; accessed through Balamandian-API's persistence boundary.         |

Do not query SIS tables directly, share SIS database credentials, or use
cross-database joins. Institutional roles inform explicitly defined application
policy; they do not automatically grant application privileges. The application
authentication and session design remains open.

## Current HTTP foundation

`src/app.ts` composes Express through a factory without binding a port.
`src/server.ts` owns startup and the listening lifecycle; `src/config/server.ts`
validates the bind address and port before listening. Database configuration lives
in `src/config/database.ts`; `src/shared/database/pool.ts` creates the pool and
verifies PostgreSQL major 18 before HTTP listens. The former empty
`src/index.ts` tooling placeholder has been removed.

The only explicit route is `GET /health`, a dependency-free liveness response.
Unknown routes receive JSON 404 and unexpected Express errors receive generic JSON 500. These baseline error codes are not a complete future application error model.
Security headers, disabled framework identification, transport timeouts, startup
failure handling, and bounded SIGINT/SIGTERM shutdown belong to this foundation.
See the README for the exact limits, configuration, and local verification command.

The `pg` adapter and its types are required but could not be installed under the
current Node mismatch; exact-pinned installation is a prerequisite, not a completed
step. No body parser, feature module, external API client, or application table
exists. Future modules must be mounted before the 404 and final error handlers.

`GET /health` remains liveness-only. Database verification gates startup but is not
a continuing readiness signal. A separate readiness endpoint is deferred until
there is a consumer. Shutdown drains HTTP before ending the pool, with one bounded
10-second deadline covering both resources, including interrupted startup.

## Code placement

The application, server, and server configuration now exist. The remaining paths
describe future placement; create them only when needed, without scaffolding empty
directories or guessing feature names.

| Location                 | Responsibility                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/app.ts`             | Compose Express and HTTP middleware without binding a port.                                              |
| `src/server.ts`          | Own startup, resource lifecycle, listening, and bounded shutdown.                                        |
| `src/config/`            | Read and validate environment configuration once at startup.                                             |
| `src/modules/<feature>/` | Feature HTTP contracts, application operations, business rules, and feature-owned persistence as needed. |
| `src/integrations/`      | External API adapters, including SIS when integration is approved.                                       |
| `src/shared/`            | Small, genuinely shared infrastructure; no miscellaneous business logic.                                 |
| `src/shared/database/`   | Pool construction, PostgreSQL version verification, and SQL migration infrastructure.                    |
| `src/scripts/migrate.ts` | Explicit migration command; never imported by HTTP startup.                                              |
| `database/migrations/`   | Migration conventions and future ordered SQL files; no application schema yet.                           |

Within a feature:

- Routes/controllers handle HTTP parsing, runtime validation, response mapping,
  and status codes; they delegate business decisions.
- Services/use cases own business rules without Express request/response objects.
  Add only layers a real operation requires.
- Repositories own parameterized SQL and persistence mapping. Make transaction
  boundaries explicit and keep SQL out of HTTP handlers.
- External adapters validate and map upstream responses into application types.
  Keep SIS response shapes and failures out of unrelated modules.
- Supply dependencies through ordinary constructors or factories. HTTP handling
  depends on application logic, which depends on explicit repository/adapter
  contracts. Avoid circular imports and unnecessary DI frameworks.
- Cross-feature access uses an intentional public interface, never another
  feature's controller, private SQL, or direct table access. Keep persistence
  ownership explicit within the shared application database.

## Configuration and security expectations

Apply these requirements when corresponding functionality is implemented:

- Validate configuration before accepting requests. Separate development, test,
  and production credentials; use deployment-managed production secrets. Add
  environment variables only with their consumers and documentation.
- Use HTTPS for deployed client and SIS traffic. Keep SIS service credentials
  server-side and transient SIS passwords out of storage, logs, and telemetry.
- Validate requests and upstream responses at runtime; TypeScript types do not
  validate untrusted data. Allowlist response fields and enforce application
  authorization at each protected operation.
- Bound request sizes, external calls, and database operations. Use safe errors and
  redacted structured logs. Configure proxy trust and abuse protection for the
  actual hosting topology, including multiple instances.
- The SIS adapter uses a configured destination, authenticated requests, bounded
  responses, controlled redirects, and explicit failure mapping. Decide retries
  per operation; do not blindly replay credential verification.
- Give the database runtime role only necessary permissions, separate migration
  privileges, and verified TLS for remote connections. Budget connection pools
  across all application instances.
- Select migration tooling before the first schema change. Run migrations through
  a controlled release step rather than implicitly at every application startup.

## Local database foundation

Centralized environment validation requires explicit database, role, and password
values and accepts only loopback destinations. The local pool defaults to five
connections with bounded acquisition, statement, lock, idle-transaction, and client
query timeouts. Driver errors are not logged because they can contain connection
details or SQL data. No remote database TLS policy is implied by this local setup.

`npm run db:migrate` uses the same configuration with separately supplied migration
credentials. A single checked-out client and transaction cover a transaction-scoped
advisory lock, creation of `public.schema_migrations`, SHA-256 history verification,
all pending SQL, and tracking inserts. Failed batches roll back and the client is
discarded. Applied files are immutable and new versions must follow applied history.
Migrations are trusted transactional SQL without their own transaction control;
the runner does not parse SQL. See `database/migrations/README.md`.

Database/role provisioning and future table grants are explicit administrative
steps. Runtime credentials must not own the schema. The first authentication schema
is still unimplemented. No migrations or database commands were run in this phase.

See [Express security](https://expressjs.com/en/advanced/best-practice-security/),
[OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html),
and [OWASP API consumption](https://api-security.owasp.org/editions/2023/en/0xaa-unsafe-consumption-of-apis/).
The current HTTP controls are listed above. Other requirements remain expectations
for the corresponding functionality, not controls already implemented.

## Decisions intentionally deferred

- Hosting, CI provider, deployment topology, and operational requirements.
- Remote PostgreSQL hosting/TLS policy and the first application schema. Local
  PostgreSQL 18 and a small tracked SQL runner are selected; parameterized SQL
  through `pg` remains the persistence convention. No ORM is introduced.
- Business API contracts, versioning, and application error conventions beyond the
  minimal HTTP fallback responses.
- Application authentication, sessions, onboarding, and authorization policy.
  SIS-API's documentation does not settle these application decisions.
- SIS fields permitted for retention, freshness/retention rules, institutional
  status rechecking, and behavior during SIS outages.
- Runtime validation, logging, abuse-protection, and test tools, selected alongside
  the behavior that needs them.

Further runtime changes require separately scoped implementation tasks. This phase
does not authorize business endpoints, schemas, authentication, SIS communication,
feature modules, or speculative infrastructure.
