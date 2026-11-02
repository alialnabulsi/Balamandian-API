# Existing local PostgreSQL setup

Verified on 2026-11-02 using the ignored local environment:

- PostgreSQL **18.6**, loopback port **5433**.
- Application database **balamandian**.
- Existing configured role **postgres**, with credentials reused privately.
- Node **24.22.2** installed through fnm; system shell may still select Node 22.

No development databases or roles need provisioning. Do not change PostgreSQL
installations or create roles for this feature. PostgreSQL 17 on 5432 is separate.

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 24.22.2
node --version
npm --version
```

Keep `.env` ignored and do not print it. Explicitly set `PGPORT=5433`; the
preserved parser defaults to 5432. `DATABASE_URL` is not consumed.

## Migrations

```sh
npm run db:migrate
```

This builds and runs the existing explicit SQL runner using private configuration,
never during server startup. `0001_authentication.sql` creates `app_user`,
`pending_registration` and `app_session`. The foundation already owns
`schema_migrations`. Never edit applied SQL; use forward migrations.

Read-only verification through your existing psql connection:

```sql
SELECT current_database(), current_user, current_setting('server_version'), inet_server_port();
SELECT version, name, checksum, applied_at FROM public.schema_migrations ORDER BY version;
SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
```

Runtime needs SELECT/INSERT/UPDATE on the three authentication tables; UUID
defaults need no sequence grants. Production needs separate schema-owning
migration and restricted runtime roles. The current local `postgres` configuration
is not a production permission model. No roles/grants are changed here.

## Isolated tests

```sh
npm run check
npm test
node --env-file-if-exists=.env --test test/integration/*.test.js
```

The final command reuses the build. Alternatively use `npm run test:integration`.
PostgreSQL 18 credentials need CREATE DATABASE permission. Tests create a new
`balamandian_auth_<32-hex-character-uuid>_test` database, validate its name and
connection, apply migrations and run fixtures only there, then drop exactly that
generated database. No existing database is reset; no roles are created. Private
process credential overrides may be used. A forced kill can leave the generated
database for deliberate manual cleanup.

SIS/email are mocked, identities fictional, and no real email or deployed SIS
request occurs. Server startup separately needs complete SIS/OTP/Resend settings.
