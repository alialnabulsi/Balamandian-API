# SQL migrations

No application schema is defined yet. The first feature migration will be
`0001_<description>.sql`; use unique, positive, four-digit versions and lowercase
snake_case descriptions. Gaps are allowed. Only `.sql` files are executed.

Run `npm run db:migrate` explicitly from the repository root with PostgreSQL 18
and migration-role credentials in the environment. Never run migrations implicitly
on HTTP startup. The runner creates only `public.schema_migrations` for tracking.

The runner validates filenames, orders migrations numerically, and checks SHA-256
checksums against the applied history. Applied files must remain present and
unchanged. New versions must come after the entire applied history. Use a new
forward migration for corrections; there is no automatic down/reset command.

One connection and one transaction cover the advisory lock, tracking-table setup,
all pending SQL, and history inserts. A failure rolls back the whole pending batch;
another runner waits for the transaction-scoped lock, subject to the lock timeout.
Success is logged only after commit. Running again applies nothing already tracked.

Migration SQL is trusted, reviewed repository code. Files must be transactional
PostgreSQL SQL: do not include transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`),
psql commands, or commands prohibited inside transactions (such as
`CREATE INDEX CONCURRENTLY`). The runner does not parse or sandbox SQL. Keep files
UTF-8 with LF endings so checksums remain stable. Application tables require
separate feature approval.

Use a schema-owning migration role and a separate runtime role with only the
permissions required by implemented features. The application does not create
databases, roles, or grants. Both commands use the same validated configuration;
override `PGUSER` and `PGPASSWORD` in the migration process, rather than committing
credentials. For a reviewed longer migration, raise `DB_STATEMENT_TIMEOUT_MS`
for that invocation (maximum 120000); do not disable timeouts.
