# Approved backend architecture

Status: approved architecture; minimal HTTP server preparation.

## Deployment and technology

Balamandian-API is a modular monolith: one deployable application whose features
have explicit internal boundaries. Use Node.js LTS, Express 5, strict TypeScript,
and ESM. Introduce PostgreSQL when application persistence is required.
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
validates the bind address and port before listening. The former empty
`src/index.ts` tooling placeholder has been removed.

The only explicit route is `GET /health`, a dependency-free liveness response.
Unknown routes receive JSON 404 and unexpected Express errors receive generic JSON 500. These baseline error codes are not a complete future application error model.
Security headers, disabled framework identification, transport timeouts, startup
failure handling, and bounded SIGINT/SIGTERM shutdown belong to this foundation.
See the README for the exact limits, configuration, and local verification command.

Express and its TypeScript declarations are the only dependencies added for this
stage. No body parser, feature module, external client, or persistence connection
is composed. Future modules must be mounted before the 404 and final error handlers.

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
| `database/migrations/`   | Ordered, versioned migrations when an application schema is approved.                                    |

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

See [Express security](https://expressjs.com/en/advanced/best-practice-security/),
[OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html),
and [OWASP API consumption](https://api-security.owasp.org/editions/2023/en/0xaa-unsafe-consumption-of-apis/).
The current HTTP controls are listed above. Other requirements remain expectations
for the corresponding functionality, not controls already implemented.

## Decisions intentionally deferred

- Hosting, CI provider, deployment topology, and operational requirements.
- PostgreSQL provider and major version, migration tooling, and the first schema.
  Parameterized SQL through `pg` is the starting preference; no driver or ORM is
  needed during HTTP server preparation.
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
