import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export async function readMigrations(directory: URL): Promise<Migration[]> {
  const migrations: Migration[] = [];
  const versions = new Set<number>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith('.sql')) continue;
    const match = /^(\d{4})_[a-z][a-z0-9_]*\.sql$/.exec(entry.name);
    const version = Number(match?.[1]);
    if (!entry.isFile() || !match || version < 1 || versions.has(version)) {
      throw new Error(
        'Migration filenames must have unique positive NNNN_description.sql versions.',
      );
    }
    const sql = await readFile(new URL(entry.name, directory), 'utf8');
    if (sql.trim() === '') throw new Error('SQL migrations must not be empty.');
    versions.add(version);
    migrations.push({
      version,
      name: entry.name,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }
  return migrations.sort((left, right) => left.version - right.version);
}

export async function runMigrations(
  pool: Pool,
  directory = new URL('../../../database/migrations/', import.meta.url),
) {
  // Read and hash files before opening a transaction; check history under the lock.
  const migrations = await readMigrations(directory);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    // Transaction-scoped lock serializes this application's migration runners.
    await client.query('SELECT pg_advisory_xact_lock(18022026, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL UNIQUE,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const history = await client.query<
      Pick<Migration, 'version' | 'name' | 'checksum'>
    >(
      'SELECT version, name, checksum FROM public.schema_migrations ORDER BY version',
    );
    for (const [index, applied] of history.rows.entries()) {
      const local = migrations[index];
      if (
        !local ||
        local.version !== applied.version ||
        local.name !== applied.name ||
        local.checksum !== applied.checksum
      ) {
        throw new Error(
          'Migration history differs from local files; restore applied migrations.',
        );
      }
    }
    const pending = migrations.slice(history.rows.length);
    for (const migration of pending) {
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
    }
    await client.query('COMMIT');
    committed = true;
    return pending.map((migration) => migration.name);
  } finally {
    try {
      if (!committed) await client.query('ROLLBACK');
    } finally {
      // Discard failed connections even if rollback also failed.
      client.release(!committed);
    }
  }
}
