import { isIP } from 'node:net';
import process from 'node:process';

export function readServerConfig() {
  const host = process.env.HOST ?? '127.0.0.1';
  const rawPort = process.env.PORT ?? '3000';
  const port = Number(rawPort);

  if (isIP(host) === 0) {
    throw new Error('HOST must be an IPv4 or IPv6 address.');
  }

  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return { host, port };
}
