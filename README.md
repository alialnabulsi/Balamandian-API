# Balamandian-API

Main backend for the Balamandian university mobile application. The approved
architecture is a modular monolith using Node.js LTS, Express 5, strict TypeScript
with ESM, and a separate PostgreSQL application database when persistence begins.

## Current scope

This repository contains a minimal runnable Express 5 HTTP server and development
tooling. `GET /health` returns `200` with `{"status":"ok"}` to confirm HTTP
liveness. It does not check external dependencies or establish readiness.

Business endpoints, authentication, database access, SIS communication, and feature
modules remain deferred. Express is the only direct runtime dependency.

## Setup

- Node.js **24.22.2**, recorded in `.node-version`.
- npm **11.19.1**, bundled with that Node release and recorded in `packageManager`.

Activate these versions using your preferred version manager or the official
Node.js distribution, then install the locked dependencies:

```sh
node --version
npm --version
npm ci
npm run check
```

No PostgreSQL instance or SIS access is required. Configuration has local defaults,
so creating `.env` is optional.

The engine ranges stay within Node 24 and npm 11, with the recorded versions as
minimums. `.npmrc` rejects incompatible engines. Prefer the exact recorded versions
for reproducibility; review and update them together for maintenance releases.
Node 24 is an established supported LTS baseline; adopting another LTS major is an
explicit toolchain update.

## Commands

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run dev`          | Compile TypeScript, then start the HTTP server. Re-run after source edits. |
| `npm start`            | Start the previously compiled `dist/server.js`.                            |
| `npm run typecheck`    | Check TypeScript once without emitting files.                              |
| `npm run build`        | Compile `src/` to ESM JavaScript and source maps in ignored `dist/`.       |
| `npm run lint`         | Run ESLint; warnings fail the command.                                     |
| `npm run lint:fix`     | Apply available ESLint fixes.                                              |
| `npm run format`       | Format maintained files with Prettier.                                     |
| `npm run format:check` | Check formatting without changing files.                                   |
| `npm run check`        | Run type checking, linting, and formatting checks.                         |

Development uses the same compiled ESM output as `npm start`; no runner or restart
package is required. There is no persistent test suite yet. Validate changes with
`npm run check`, `npm run build`, and a focused local smoke check as needed.

## Running and checking the server

```sh
npm run dev
```

From another terminal:

```sh
curl --fail http://127.0.0.1:3000/health
```

On Windows PowerShell, use `curl.exe` for the same command. The expected body is
`{"status":"ok"}`. For a compiled start, use `npm run build` followed by
`npm start`. Stop with Ctrl+C; deployment environments can send SIGTERM.

Copy `.env.example` to ignored `.env` only when overrides are needed. `npm start`
uses Node's native optional environment-file loading; exported process variables
take precedence. No dotenv dependency is used.

| Variable   | Default                           | Meaning                                                                                      |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `HOST`     | `127.0.0.1`                       | IPv4 or IPv6 bind address. Use `0.0.0.0` explicitly when a deployment needs external access. |
| `PORT`     | `3000`                            | Decimal integer from 1 to 65535. Invalid or empty values fail startup.                       |
| `NODE_ENV` | Express defaults to `development` | Express runtime environment. Set `production` in a deployment environment.                   |

`HOST` and `PORT` are validated before listening; invalid configuration and bind
errors exit with a nonzero status. The listening message is printed only after a
successful bind. Optional `.env` parsing occurs before the entry point runs.

## HTTP foundation

- `src/app.ts` exports `createApp()` without listening or registering process
  handlers. It composes the health route, JSON 404 fallback, and final error handler.
- `src/config/server.ts` reads and validates the bind configuration once at startup.
- `src/server.ts` owns the Node HTTP server, startup errors, and shutdown. Header
  receipt is limited to 10 seconds and whole-request receipt to 30 seconds; these
  are transport limits, not future business-operation deadlines.
- SIGINT/SIGTERM stop accepting connections and allow active requests to finish.
  After 10 seconds, remaining HTTP connections are closed and the exit status is
  nonzero. Repeated shutdown signals are ignored while draining. On Windows, use
  terminal Ctrl+C; programmatically sending SIGTERM forcibly terminates processes.
- Responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  `X-Powered-By` and ETags are disabled. Unknown routes return JSON 404; unexpected
  Express errors return generic JSON 500 without exception details. Errors after
  response headers are sent delegate to Express's default connection handling.
- Unexpected request errors currently emit only a generic server-side message.
  Structured, redacted diagnostics and application error categories are deferred.
- Body parsers, CORS, cookies, proxy trust, and additional middleware are not enabled
  without a current consumer. Future request-body routes must introduce bounded
  parsing and runtime validation with their contracts.
- HTTP is local by default. Public deployment requires a separately configured TLS
  boundary and an explicit review of hosting, proxy trust, and abuse protection.

## Tooling and workflow conventions

- TypeScript uses `strict`, checked indexed access, exact optional properties, and
  NodeNext module semantics. `ES2024` and Node types describe the server runtime;
  browser globals are excluded.
- Use ESM `import`/`export`, `import type` for type-only imports, and explicit `.js`
  extensions in relative imports written in TypeScript. TypeScript resolves those
  to source files and preserves runtime-valid paths in emitted JavaScript.
  Avoid bundler-only aliases and CommonJS conventions.
- Development compiles before running. Running `.ts` directly in Node does not
  type-check it and is not this project's build workflow.
- ESLint uses flat configuration and recommended rules, with type-aware rules for
  TypeScript. Prettier owns formatting; no overlapping style plugins are needed.
- Direct dependencies are exact-pinned. Keep `package-lock.json` in
  Git and use `npm ci` for checkouts and CI. Add or update tools deliberately with
  `npm install --save-dev` and review the lockfile diff.
- TypeScript 6.0 is selected because typescript-eslint currently supports versions
  below 6.1. Upgrade the compiler and lint stack as a compatible set.
- Dependency lifecycle scripts are disabled by `.npmrc`; the present tools do not
  require them. Explicit commands such as `npm run check` still work. Review a
  future dependency's script requirements before changing this policy.
- The package is private, versioned `0.1.0` for preparation. Package versioning is
  separate from future API versioning; there is no API contract yet.
- Work on `dev` or a focused branch from it and review before merging. Future CI
  should run `npm ci`, `npm run check`, and `npm run build`. No CI provider,
  hosting, Git hooks, or deployment infrastructure is selected by this setup.
- Keep secrets, local configuration, logs, dependencies, and generated output out
  of Git. Use UTF-8, LF line endings, and two-space indentation.

## Dependency audit follow-up

Reviewed on 2026-10-31: npm reports 11 moderate dependency-tree entries stemming
from one [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
All affected packages belong to the development lint stack. Express's addition did
not change the 11 moderate entries. The advisory concerns attacker-controlled glob patterns.
Keep lint configuration and patterns trusted.

The current upstream lint packages require minimatch 10; the patched 11.0.1 release
is outside their declared ranges and changes the matching implementation. A
compatible upstream update remains pending. No unsupported major override or
forced audit downgrade is applied. Revisit this advisory when updating the lint
stack; the tooling checks do not establish a clean security audit.

## Architecture and future work

Read [the architecture record](docs/architecture.md) for system ownership, module
boundaries, security expectations, and open decisions.
[AGENTS.md](AGENTS.md) requires official documentation before future backend work.

## Official references consulted

- [Node.js releases](https://nodejs.org/en/about/previous-releases) and [Node 24 TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [Node 24 HTTP server](https://nodejs.org/docs/latest-v24.x/api/http.html), [signals](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events), and [environment variables](https://nodejs.org/docs/latest-v24.x/api/environment_variables.html)
- [TypeScript module options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) and [TSConfig](https://www.typescriptlang.org/tsconfig/)
- [npm package configuration](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), and [npm configuration](https://docs.npmjs.com/cli/v11/using-npm/config/)
- [Express production security](https://expressjs.com/en/advanced/best-practice-security/)
- [Express 5 API](https://expressjs.com/en/5x/api/), [error handling](https://expressjs.com/en/guide/error-handling/), and [graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/)
- [ESLint configuration](https://eslint.org/docs/latest/use/configure/configuration-files), [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/), and [supported versions](https://typescript-eslint.io/users/dependency-versions/)
- [Prettier installation](https://prettier.io/docs/install) and [ignore rules](https://prettier.io/docs/ignore)
- [OWASP npm security](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html), [REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), and [safe API consumption](https://api-security.owasp.org/editions/2023/en/0xaa-unsafe-consumption-of-apis/)
