import { createServer } from 'node:http';
import process from 'node:process';

import { createApp } from './app.js';
import { readServerConfig } from './config/server.js';

function startServer() {
  const { host, port } = readServerConfig();
  const server = createServer(
    { headersTimeout: 10_000, requestTimeout: 30_000 },
    createApp(),
  );
  let stopping = false;

  function shutdown() {
    if (stopping) return;
    stopping = true;
    console.info('Stopping HTTP server.');

    const deadline = setTimeout(() => {
      console.error('HTTP shutdown exceeded 10 seconds; closing connections.');
      process.exitCode = 1;
      server.closeAllConnections();
    }, 10_000);
    deadline.unref();

    server.close((error) => {
      clearTimeout(deadline);
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);

      if (error) {
        console.error('HTTP shutdown failed.');
        process.exitCode = 1;
        return;
      }

      console.info('HTTP server stopped.');
    });
  }

  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error('HTTP server failed:', error.code ?? 'UNKNOWN_ERROR');
    process.exitCode = 1;
    if (server.listening) shutdown();
  });

  server.once('listening', () => {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    const address = host.includes(':') ? `[${host}]` : host;
    console.info(`Balamandian API listening on http://${address}:${port}`);
  });

  server.listen(port, host);
}

try {
  startServer();
} catch (error) {
  console.error(
    'HTTP server startup failed:',
    error instanceof Error ? error.message : 'Unknown error.',
  );
  process.exitCode = 1;
}
