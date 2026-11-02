import process from 'node:process';

import type { Pool } from 'pg';

import { readDatabaseConfig } from '../config/database.js';
import { runMigrations } from '../shared/database/migrations.js';
import { createDatabasePool, verifyDatabase } from '../shared/database/pool.js';

async function main() {
  let pool: Pool | undefined;
  try {
    pool = createDatabasePool(readDatabaseConfig());
    await verifyDatabase(pool);
    const applied = await runMigrations(pool);
    console.info(`Migrations complete: ${applied.length} applied.`);
    for (const name of applied) console.info(`Applied ${name}`);
  } catch {
    console.error(
      'Migration failed. Check PostgreSQL 18, database configuration, privileges, and migration history/files.',
    );
    process.exitCode = 1;
  } finally {
    try {
      await pool?.end();
    } catch {
      console.error('Database pool shutdown failed.');
      process.exitCode = 1;
    }
  }
}

await main();
