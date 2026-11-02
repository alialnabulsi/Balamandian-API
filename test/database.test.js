import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL, URL } from 'node:url';

import { readDatabaseConfig } from '../dist/config/database.js';
import { readMigrations } from '../dist/shared/database/migrations.js';

const environment = {
  PGDATABASE: 'example_database',
  PGUSER: 'example_runtime_role',
  PGPASSWORD: 'test-only-credential',
};

test('database configuration is explicit, local, and bounded', () => {
  const config = readDatabaseConfig(environment);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5432);
  assert.equal(config.max, 5);
  assert.equal(config.ssl, false);
  assert.ok(config.connectionTimeoutMillis > 0);
  assert.ok(config.statement_timeout > 0);
  assert.ok(config.query_timeout > config.statement_timeout);
  assert.equal(config.password, environment.PGPASSWORD);
});

test('invalid configuration never echoes supplied credentials or destinations', () => {
  for (const name of ['PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    assert.throws(() => readDatabaseConfig({ ...environment, [name]: '' }), {
      message: `${name} must be configured and nonempty.`,
    });
  }
  const secret = 'do-not-echo-this-value';
  assert.throws(
    () => readDatabaseConfig({ ...environment, PGHOST: secret }),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('numeric settings reject empty, malformed, zero, and excessive values', () => {
  for (const name of [
    'PGPORT',
    'DB_POOL_MAX',
    'DB_CONNECTION_TIMEOUT_MS',
    'DB_STATEMENT_TIMEOUT_MS',
  ]) {
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      '1e3',
      ' 5',
      '999999999999999999999',
    ]) {
      assert.throws(() =>
        readDatabaseConfig({ ...environment, [name]: value }),
      );
    }
  }
});

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'balamandian-migrations-'));
  try {
    await run(pathToFileURL(`${directory}/`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('migration files are ordered and checksummed, with non-SQL files ignored', async () => {
  await withDirectory(async (directory) => {
    const sql = 'SELECT 1;\n';
    await writeFile(new URL('0002_second.sql', directory), 'SELECT 2;\n');
    await writeFile(new URL('0001_first.sql', directory), sql);
    await writeFile(new URL('README.md', directory), 'Documentation');
    const migrations = await readMigrations(directory);
    assert.deepEqual(
      migrations.map(({ version }) => version),
      [1, 2],
    );
    assert.equal(
      migrations[0].checksum,
      createHash('sha256').update(sql).digest('hex'),
    );
    assert.equal(migrations[0].sql, sql);
  });
});

test('invalid, duplicate, zero, and empty migrations are rejected before database access', async () => {
  for (const filenames of [
    ['invalid.sql'],
    ['0000_zero.sql'],
    ['0001_first.sql', '0001_duplicate.sql'],
    ['0001_EMPTY.sql'],
  ]) {
    await withDirectory(async (directory) => {
      for (const name of filenames)
        await writeFile(new URL(name, directory), 'SELECT 1;');
      await assert.rejects(readMigrations(directory));
    });
  }
  await withDirectory(async (directory) => {
    await writeFile(new URL('0001_empty.sql', directory), ' \n');
    await assert.rejects(readMigrations(directory));
  });
});
