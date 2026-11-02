# Complete local database setup (Windows PowerShell)

The 2026-11-02 inspection found Node 22.13.1, npm 11.19.1, and PostgreSQL 17.6
running on port 5432. Node 24.22.2 and PostgreSQL 18 were not found in the inspected
installations. No `.env` or database credentials were available. Installation,
provisioning, connection checks, and migrations are blocked until the following
manual setup is complete. No database or role changes have been made.

## 1. Activate the required Node version

`fnm` is already available. In the shell that will run the project commands:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm install 24.22.2
fnm use 24.22.2
node --version
npm --version
```

Require `v24.22.2` and `11.19.1` before proceeding. Do not use the managed Node
26 installation, modify the engine ranges, or use `--force`. Node selection applies
to the configured shell; verify versions again in any different shell.

Then, from the repository root, install the already selected dependencies:

```powershell
npm install --save-exact pg@8.23.1
npm install --save-dev --save-exact @types/pg@8.23.1
```

Preserve both `package.json` and `package-lock.json` changes. Neither dependency
has been installed yet; these commands have not been run under a supported Node
version.

## 2. Install PostgreSQL 18 alongside 17

Use the installer linked from the official
[PostgreSQL Windows download page](https://www.postgresql.org/download/windows/).
Select version 18, its own installation/data directories and Windows service,
and a free port. Keep PostgreSQL 17, its data directory, and its existing port
5432 unchanged. Port 5433 is a candidate only if the installer confirms it is
available; it is not a verified PostgreSQL 18 port.

Keep the new administrator password private. Do not reset credentials on the
existing PostgreSQL 17 cluster. Record the actual PostgreSQL 18 port and binary
directory selected during installation.

Set these nonsecret values to the actual installation and administrator account:

```powershell
$pg18Bin = 'C:\Program Files\PostgreSQL\18\bin' # Adjust if installed elsewhere.
$pg18Port = [int](Read-Host 'Actual PostgreSQL 18 port')
$pg18Admin = Read-Host 'PostgreSQL 18 administrator role'
& "$pg18Bin\psql.exe" -X -W -h 127.0.0.1 -p $pg18Port -U $pg18Admin -d postgres
```

Enter the administrator password at the hidden prompt. In psql, inspect only:

```sql
SHOW server_version;
SHOW port;
SELECT datname FROM pg_database WHERE datname = 'balamandian';
SELECT rolname FROM pg_roles
WHERE rolname IN ('balamandian_app', 'balamandian_migrator');
```

Require server major 18 and confirm the actual port. If the database or either
role already exists, **stop provisioning**: inspect ownership and permissions
before deciding whether to reuse it. Do not overwrite databases, reset passwords,
or alter existing roles. Existing role changes require explicit approval.
Exit psql with `\q`.

## 3. Provision only absent, dedicated resources

Only after the preflight confirms that all three names are absent, an authorized
administrator can create the two login roles and the new database:

```powershell
& "$pg18Bin\createuser.exe" -W -h 127.0.0.1 -p $pg18Port -U $pg18Admin --login --no-superuser --no-createdb --no-createrole --pwprompt balamandian_migrator
if ($LASTEXITCODE -ne 0) { throw 'Migration role creation failed; stop here.' }
& "$pg18Bin\createuser.exe" -W -h 127.0.0.1 -p $pg18Port -U $pg18Admin --login --no-superuser --no-createdb --no-createrole --pwprompt balamandian_app
if ($LASTEXITCODE -ne 0) { throw 'Application role creation failed; stop here.' }
& "$pg18Bin\createdb.exe" -W -h 127.0.0.1 -p $pg18Port -U $pg18Admin --owner=balamandian_migrator balamandian
if ($LASTEXITCODE -ne 0) { throw 'Database creation failed; stop here.' }
```

Stop immediately if any command fails. The prompts initialize passwords only for
the newly created roles; choose distinct passwords and keep them out of commands,
logs, and source control. Do not run these commands against PostgreSQL 17.

Connect as the administrator to the **new** database:

```powershell
& "$pg18Bin\psql.exe" -X -W -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $pg18Port -U $pg18Admin -d balamandian
```

Confirm the connection target, then restrict only this new database and schema:

```sql
SELECT current_database(), current_setting('server_version_num'), inet_server_port();
REVOKE ALL ON DATABASE balamandian FROM PUBLIC;
GRANT CONNECT ON DATABASE balamandian TO balamandian_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO balamandian_app;
```

The migration role owns the database and can create schema objects through
`pg_database_owner`. The application role receives connection/schema usage only:
no schema creation, database ownership, superuser privileges, role membership,
or automatic access to migration tracking. Grant application-table permissions
alongside the future feature migrations; no application tables are created now.
These commands are instructions, not changes already executed.

## 4. Configure the ignored environment file

From the repository root, create `.env` only if absent:

```powershell
if (Test-Path -LiteralPath .env) { throw 'Existing .env preserved; edit it locally.' }
Copy-Item -LiteralPath .env.example -Destination .env -ErrorAction Stop
git check-ignore .env
```

Edit `.env` locally: set `PGHOST=127.0.0.1`, `PGPORT` to the **verified PostgreSQL
18 port**, `PGDATABASE=balamandian`, `PGUSER=balamandian_app`, and `PGPASSWORD` to
the new application role's password. Use Node's documented `.env` quoting for
special characters. Never paste this file into chat, print it, or commit it.
Leave the migration password out of the application `.env`.

Check connectivity as each role using psql's hidden password prompt:

```powershell
& "$pg18Bin\psql.exe" -X -W -h 127.0.0.1 -p $pg18Port -U balamandian_app -d balamandian
# Repeat with -U balamandian_migrator for the migration role.
```

Run the following read-only query for each role:

```sql
SELECT current_user, current_database(), current_setting('server_version_num'),
       inet_server_port(),
       has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
       has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;
SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
```

Expect `can_create=false` for the application role, `true` for the migration role,
and all five role flags `false` for both. Both must connect to the intended
database on major 18.

## 5. Verify once, then run the compiled migration command

With the required Node active, run `npm run check`, then `npm test`. Stop if a
command fails. This covers typecheck, lint, formatting, one build, and the existing
database-independent tests without repeating the build separately.

After success, temporarily supply migration credentials and use that build:

```powershell
$previousDbUser = $env:PGUSER
$previousDbPassword = $env:PGPASSWORD
try {
  $env:PGUSER = 'balamandian_migrator'
  $env:PGPASSWORD = [Net.NetworkCredential]::new('', (Read-Host 'Migration password' -AsSecureString)).Password
  node --env-file=.env --enable-source-maps dist/scripts/migrate.js
  if ($LASTEXITCODE -ne 0) { throw 'Migration command failed; stop here.' }
  # One repeat checks idempotency, without rebuilding or adding a dummy migration.
  node --env-file=.env --enable-source-maps dist/scripts/migrate.js
  if ($LASTEXITCODE -ne 0) { throw 'Migration repeat failed; stop here.' }
} finally {
  $env:PGUSER = $previousDbUser
  $env:PGPASSWORD = $previousDbPassword
  $previousDbPassword = $null
}
```

As the migration role in psql, inspect:

```sql
SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
SELECT version, name, checksum, applied_at FROM public.schema_migrations ORDER BY version;
```

Expect only `schema_migrations`, owned by `balamandian_migrator`, with zero history
rows because no application migration exists. Both runs should report zero applied.
This verifies tracking-table initialization and an idempotent empty run; recording
an actual feature migration is verified when that migration is approved.

Finally, `npm start` should listen only after the PostgreSQL 18 check succeeds.
Verify `/health` from another terminal, then use Ctrl+C to verify pool cleanup.
Keep all repository changes uncommitted on `dev`.

References: [fnm shell setup](https://github.com/Schniz/fnm#shell-setup),
[createuser](https://www.postgresql.org/docs/18/app-createuser.html),
[createdb](https://www.postgresql.org/docs/18/app-createdb.html),
[schema permissions](https://www.postgresql.org/docs/18/ddl-schemas.html), and
[Node environment files](https://nodejs.org/docs/latest-v24.x/api/environment_variables.html).
