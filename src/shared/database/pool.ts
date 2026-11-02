import { Pool } from 'pg';

import type { readDatabaseConfig } from '../../config/database.js';

export function createDatabasePool(
  config: ReturnType<typeof readDatabaseConfig>,
) {
  const pool = new Pool(config);
  pool.on('error', () => {
    // Database error objects may contain connection details or future query data.
    console.error('Unexpected error on an idle database connection.');
  });
  return pool;
}

export async function verifyDatabase(pool: Pool) {
  const result = await pool.query<{ server_version_num: string }>(
    'SHOW server_version_num',
  );
  const version = Number(result.rows[0]?.server_version_num);
  if (!Number.isInteger(version) || version < 180_000 || version >= 190_000) {
    throw new Error('A PostgreSQL 18 server is required.');
  }
}
