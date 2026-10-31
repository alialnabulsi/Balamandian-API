# Official documentation first

Before proposing, writing, reviewing, or changing backend code or tooling, consult
the relevant current official documentation for the versions used here:

- Node.js: https://nodejs.org/docs/latest-v24.x/api/ and https://nodejs.org/en/about/previous-releases
- TypeScript: https://www.typescriptlang.org/docs/
- npm: https://docs.npmjs.com/
- Express: https://expressjs.com/en/5x/api/ and https://expressjs.com/en/advanced/best-practice-security/
- PostgreSQL, when relevant: https://www.postgresql.org/docs/
- Security: https://cheatsheetseries.owasp.org/ and https://owasp.org/API-Security/
- ESLint, typescript-eslint, Prettier, and other dependencies: their official documentation.

Use documented behavior. Distinguish framework requirements from project choices.
If documentation cannot be accessed, say so; do not claim it was checked. Summarize
relevant sources and decisions in the work report.

# Scope and architecture

- Read README.md and docs/architecture.md before implementation.
- This repository is in tooling preparation. Implement features only when the user
  explicitly authorizes them; do not pre-create endpoints, schemas, authentication,
  SIS communication, feature modules, or speculative infrastructure.
- Preserve the modular monolith, strict TypeScript, and ESM conventions.
- Organize future code by feature. Separate HTTP handling, business rules,
  persistence, and external integration; supply dependencies explicitly.
- SIS-API owns institutional credential verification and member retrieval.
  Balamandian-API owns application behavior and its separate PostgreSQL database.
  Do not access SIS's database or expose service credentials to the mobile client.
- Add dependencies only for a current, explained purpose. Check compatibility before
  upgrades; update package.json and package-lock.json together.
- Never commit secrets, dependencies, generated builds, or real member data.
- Keep verification proportional. Use npm run check and a build for tooling or
  compilation changes; add behavioral tests alongside real behavior.
- Work on the requested branch. Do not commit or push unless instructed.
