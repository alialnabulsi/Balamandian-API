import { createServer } from 'node:http';
import process from 'node:process';

import { createApp } from './app.js';
import { readAuthConfig } from './config/auth.js';
import { readDatabaseConfig } from './config/database.js';
import { readServerConfig } from './config/server.js';
import { createAuthDependencies } from './modules/auth/auth.composition.js';
import { createDatabasePool, verifyDatabase } from './shared/database/pool.js';

async function startServer() {
  const { host, port } = readServerConfig();
  const authConfig = readAuthConfig();
  const pool = createDatabasePool(readDatabaseConfig());
  const auth = createAuthDependencies(pool, authConfig);
  const server = createServer(
    { headersTimeout: 10_000, requestTimeout: 30_000 },
    createApp(auth.service),
  );
  let shutdownPromise: Promise<void> | undefined;

  function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.info('Stopping HTTP server and database pool.');

      const deadline = setTimeout(() => {
        console.error(
          'Shutdown exceeded 10 seconds; forcing process termination.',
        );
        server.closeAllConnections();
        process.exit(1);
      }, 10_000);
      deadline.unref();

      try {
        // Drain HTTP work before closing the pool that request handlers will use.
        await new Promise<void>((resolve) => {
          server.close((error) => {
            if (
              error &&
              !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')
            ) {
              console.error('HTTP shutdown failed.');
              process.exitCode = 1;
            }
            resolve();
          });
        });
        auth.close();
        await pool.end();
        console.info('HTTP server and database pool stopped.');
      } catch {
        console.error('Database pool shutdown failed.');
        process.exitCode = 1;
      } finally {
        clearTimeout(deadline);
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
      }
    })();
    return shutdownPromise;
  }

  function handleSignal() {
    void shutdown();
  }

  // Install before the initial connection check so startup can also be interrupted.
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  server.once('error', () => {
    console.error('HTTP server failed.');
    process.exitCode = 1;
    void shutdown();
  });

  server.once('listening', () => {
    const address = host.includes(':') ? `[${host}]` : host;
    console.info(`Balamandian API listening on http://${address}:${port}`);
  });

  try {
    await verifyDatabase(pool);
    if (!shutdownPromise) server.listen(port, host);
  } catch {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    await shutdown();
    throw new Error('Database initialization failed.');
  }
}

startServer().catch(() => {
  console.error(
    'API startup failed. Check server/database/SIS/SMTP configuration and local PostgreSQL 18 availability.',
  );
  process.exitCode = 1;
});
