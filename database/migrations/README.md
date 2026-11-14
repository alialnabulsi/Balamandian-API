# SQL migrations

The feature migrations currently begin with `0001_authentication.sql`, containing
application users, pending registrations and opaque bearer sessions, followed by
`0002_marketplace.sql`, containing marketplace categories, places, images,
opening hours, favorites, ratings and place posts. Use unique, positive,
four-digit versions and lowercase snake_case descriptions. Gaps are allowed. Only
`.sql` files are executed.

Run `npm run db:migrate` explicitly from the repository root with PostgreSQL 18
and migration-role credentials in the environment. Never run migrations implicitly
on HTTP startup. The runner creates only `public.schema_migrations` for tracking.

Do not apply a tracked migration manually through pgAdmin. Manually created tables
are invisible to `public.schema_migrations`, so the runner will treat their
migration as pending and fail when it tries to create them again. Use pgAdmin for
inspection and explicitly separate development seed data, not as an alternative
schema-migration mechanism.

The runner validates filenames, orders migrations numerically, and checks SHA-256
checksums against the applied history. Applied files must remain present and
unchanged. New versions must come after the entire applied history. Use a new
forward migration for corrections; there is no automatic down/reset command.

One connection and one transaction cover the advisory lock, tracking-table setup,
all pending SQL, and history inserts. A failure rolls back the whole pending batch;
another runner waits for the transaction-scoped lock, subject to the lock timeout.
Success is logged only after commit. Running again applies nothing already tracked.

If a local database predates migration tracking and already contains manually
created tables, preserve its data and stop before running more migrations. First
verify that every existing column, constraint and index matches the corresponding
immutable migration. Only after that verification may the existing version be
baselined in `public.schema_migrations` with the exact filename and SHA-256 checksum
computed by the repository's migration reader. This is a one-time recovery for an
existing local database, not the normal setup path and not permission to edit an
applied migration. Fresh databases must use `npm run db:migrate` from the start.

Migration SQL is trusted, reviewed repository code. Files must be transactional
PostgreSQL SQL: do not include transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`),
psql commands, or commands prohibited inside transactions (such as
`CREATE INDEX CONCURRENTLY`). The runner does not parse or sandbox SQL. Keep files
UTF-8 with LF endings so checksums remain stable. Authentication tables are
authorized by the complete authentication implementation task.

Use a schema-owning migration role and a separate runtime role with only the
permissions required by implemented features. The application does not create
databases, roles, or grants. Both commands use the same validated configuration;
override `PGUSER` and `PGPASSWORD` in the migration process, rather than committing
credentials. For a reviewed longer migration, raise `DB_STATEMENT_TIMEOUT_MS`
for that invocation (maximum 120000); do not disable timeouts.
