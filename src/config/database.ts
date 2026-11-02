import process from 'node:process';

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (value === undefined || value.trim() === '' || value.includes('\0')) {
    throw new Error(`${name} must be configured and nonempty.`);
  }
  return value;
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number,
) {
  const raw = environment[name] ?? String(fallback);
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

export function readDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const host = environment.PGHOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error(
      'PGHOST must be a loopback address or localhost for local development.',
    );
  }

  const statementTimeout = integer(
    environment,
    'DB_STATEMENT_TIMEOUT_MS',
    10_000,
    120_000,
  );
  return {
    host,
    port: integer(environment, 'PGPORT', 5432, 65_535),
    database: required(environment, 'PGDATABASE'),
    user: required(environment, 'PGUSER'),
    password: required(environment, 'PGPASSWORD'),
    max: integer(environment, 'DB_POOL_MAX', 5, 20),
    connectionTimeoutMillis: integer(
      environment,
      'DB_CONNECTION_TIMEOUT_MS',
      5000,
      30_000,
    ),
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout + 1000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'balamandian-api',
    ssl: false,
  };
}
