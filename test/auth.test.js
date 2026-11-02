import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { clearTimeout, setTimeout } from 'node:timers';

import { createApp } from '../dist/app.js';
import { readAuthConfig } from '../dist/config/auth.js';
import { SisAdapter } from '../dist/integrations/sis/sis.adapter.js';
import { AuthRateLimiter } from '../dist/modules/auth/auth.middleware.js';
import {
  generateOtp,
  generateSessionToken,
  hashSessionToken,
  matchesOtp,
  otpVerifier,
} from '../dist/modules/auth/auth.security.js';
import {
  credentials,
  verification,
} from '../dist/modules/auth/auth.validators.js';

const { fetch, Response } = globalThis;

const secret = randomBytes(32).toString('hex');
const environment = {
  SIS_BASE_URL: 'https://sis.example.edu',
  SIS_SERVICE_API_KEY: 'test-only-service-key',
  OTP_SECRET: secret,
  RESEND_API_KEY: 're_test_only_api_key',
  RESEND_FROM_EMAIL: 'no-reply@example.edu',
};
const config = readAuthConfig(environment);
const fixture = { identifier: 'FICTION001', password: 'test-only-password' };
const success = {
  data: {
    userId: 'FICTION001',
    email: 'member@example.edu',
    firstName: 'Example',
    roles: ['student'],
    student: { programs: [{ id: 1 }] },
    instructor: null,
    advisor: null,
  },
};

test('auth configuration requires Resend secrets and enforces HTTPS and bounded policy', () => {
  assert.equal(config.sessionLifetimeSeconds, 604800);
  assert.equal(config.resendTimeoutMs, 5000);
  assert.equal(config.resendApiKey, environment.RESEND_API_KEY);
  assert.equal(config.resendFromEmail, environment.RESEND_FROM_EMAIL);
  for (const key of [
    'SIS_BASE_URL',
    'SIS_SERVICE_API_KEY',
    'OTP_SECRET',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
  ]) {
    assert.throws(() => readAuthConfig({ ...environment, [key]: '' }));
  }
  for (const url of [
    'http://sis.example.edu',
    'https://user:secret@sis.example.edu',
    'https://sis.example.edu/api',
    'https://sis.example.edu?key=secret',
  ]) {
    assert.throws(() => readAuthConfig({ ...environment, SIS_BASE_URL: url }));
  }
  for (const key of [
    'SIS_TIMEOUT_MS',
    'SESSION_LIFETIME_SECONDS',
    'RESEND_TIMEOUT_MS',
  ]) {
    for (const value of ['', '0', 'NaN', '9999999999'])
      assert.throws(() => readAuthConfig({ ...environment, [key]: value }));
  }
  assert.throws(() => readAuthConfig({ ...environment, OTP_SECRET: 'weak' }));
  for (const value of [
    ' ',
    're_contains space',
    're_key\n',
    're_key\r',
    're_key\0',
  ]) {
    assert.throws(() =>
      readAuthConfig({ ...environment, RESEND_API_KEY: value }),
    );
  }
  for (const value of [
    'invalid',
    'Name <sender@example.edu>',
    'a@example.edu,b@example.edu',
    'a@example.edu\r\nBcc: x@example.edu',
    'x'.repeat(255) + '@example.edu',
  ]) {
    assert.throws(() =>
      readAuthConfig({ ...environment, RESEND_FROM_EMAIL: value }),
    );
  }
  assert.throws(
    () => readAuthConfig({ ...environment, RESEND_DEBUG: 'true' }),
    {
      message: 'RESEND_DEBUG must not be enabled for authentication email.',
    },
  );
  assert.doesNotThrow(() =>
    readAuthConfig({
      ...environment,
      NODE_ENV: 'production',
      RESEND_DEBUG: 'false',
    }),
  );
});

test('OTP and bearer token generators use opaque secrets and identity-bound verifiers', () => {
  const id = randomUUID();
  const otp = generateOtp();
  assert.match(otp, /^\d{6}$/);
  const verifier = otpVerifier(secret, id, otp);
  assert.equal(matchesOtp(verifier, otpVerifier(secret, id, otp)), true);
  assert.equal(
    matchesOtp(verifier, otpVerifier(secret, randomUUID(), otp)),
    false,
  );
  assert.equal(
    matchesOtp(verifier, otpVerifier(randomBytes(32).toString('hex'), id, otp)),
    false,
  );
  const token = generateSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(generateSessionToken(), token);
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});

test('strict request validation preserves passwords and rejects extra fields and malformed OTPs', () => {
  assert.deepEqual(
    credentials({ identifier: ' FICTION001 ', password: ' padded password ' }),
    { identifier: 'FICTION001', password: ' padded password ' },
  );
  for (const value of [
    null,
    [],
    {},
    { ...fixture, roles: ['admin'] },
    { ...fixture, password: '' },
    { ...fixture, identifier: 'has space' },
  ]) {
    assert.throws(() => credentials(value), { code: 'VALIDATION_ERROR' });
  }
  const id = randomUUID();
  assert.deepEqual(verification({ pendingRegistrationId: id, otp: '000123' }), {
    id,
    otp: '000123',
  });
  for (const otp of [123456, '12345', ' 123456', 'abcdef'])
    assert.throws(() => verification({ pendingRegistrationId: id, otp }));
});

test('SIS adapter sends the confirmed HTTPS contract once and accepts nested academic data', async () => {
  let calls = 0;
  const adapter = new SisAdapter(config, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://sis.example.edu/api/v1/auth/verify');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(
      options.headers.Authorization,
      `Bearer ${config.sisServiceKey}`,
    );
    assert.deepEqual(JSON.parse(options.body), fixture);
    return Response.json(success);
  });
  assert.deepEqual(await adapter.verify(fixture), {
    userId: 'FICTION001',
    email: 'member@example.edu',
  });
  assert.equal(calls, 1);
});

test('SIS errors distinguish bad member credentials, bad service key, rate limits and outages without leaking upstream text', async () => {
  for (const [status, body, code, expectedStatus] of [
    [
      401,
      { error: { code: 'INVALID_CREDENTIALS', message: 'private details' } },
      'SIS_INVALID_CREDENTIALS',
      401,
    ],
    [401, { error: { code: 'SERVICE_UNAUTHORIZED' } }, 'SIS_UNAVAILABLE', 503],
    [429, {}, 'SIS_RATE_LIMITED', 429],
    [503, {}, 'SIS_UNAVAILABLE', 503],
    [400, { error: { code: 'VALIDATION_ERROR' } }, 'VALIDATION_ERROR', 400],
    [401, { error: { code: 'UNKNOWN' } }, 'SIS_INVALID_RESPONSE', 502],
  ]) {
    let calls = 0;
    const adapter = new SisAdapter(config, async () => {
      calls++;
      return Response.json(body, { status });
    });
    await assert.rejects(adapter.verify(fixture), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, expectedStatus);
      assert.equal(error.message.includes('private details'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(
    new SisAdapter(config, () =>
      Promise.reject(new Error('private network details')),
    ).verify(fixture),
    { code: 'SIS_UNAVAILABLE' },
  );
});

test('SIS rejects malformed, oversized and invalid identity responses', async () => {
  for (const payload of [
    {},
    { data: { userId: '', email: 'member@example.edu' } },
    { data: { userId: 'FICTION001', email: 'bad\nBcc: someone@example.edu' } },
    { data: { userId: 'FICTION001', email: 'x'.repeat(300) } },
    {
      data: {
        userId: 'FICTION001',
        email: 'valid@example.edu',
        huge: 'x'.repeat(262144),
      },
    },
  ]) {
    await assert.rejects(
      new SisAdapter(config, async () => Response.json(payload)).verify(
        fixture,
      ),
      { code: 'SIS_INVALID_RESPONSE' },
    );
  }
  for (const response of [
    new Response('not json', {
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response('<html>error</html>'),
  ]) {
    await assert.rejects(
      new SisAdapter(config, async () => response).verify(fixture),
      { code: 'SIS_INVALID_RESPONSE' },
    );
  }
});

test('SIS timeout aborts credential requests without retrying', async () => {
  let calls = 0;
  const adapter = new SisAdapter(
    { ...config, sisTimeoutMs: 15 },
    (_url, options) =>
      new Promise((_resolve, reject) => {
        calls++;
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }),
  );
  // Keep the test process alive while the adapter's unref'ed timeout is pending.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(adapter.verify(fixture), { code: 'SIS_UNAVAILABLE' });
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(calls, 1);
});

async function withHttp(t, service, run) {
  const server = createServer(createApp(service));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  await run(`http://127.0.0.1:${server.address().port}`);
}

test('HTTP bounds bodies, rejects invalid JSON/types and keeps safe error envelopes', async (t) => {
  let calls = 0;
  await withHttp(
    t,
    {
      register: () => {
        calls++;
        throw new Error('private credential details');
      },
    },
    async (base) => {
      for (const [body, type, status, code] of [
        ['{', 'application/json', 400, 'INVALID_JSON'],
        [
          JSON.stringify({ ...fixture, unexpected: true }),
          'application/json',
          400,
          'VALIDATION_ERROR',
        ],
        ['x'.repeat(9000), 'application/json', 413, 'REQUEST_TOO_LARGE'],
        [JSON.stringify(fixture), 'text/plain', 415, 'UNSUPPORTED_MEDIA_TYPE'],
        [JSON.stringify(fixture), 'application/json', 500, 'INTERNAL_ERROR'],
      ]) {
        const response = await fetch(`${base}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': type },
          body,
        });
        assert.equal(response.status, status);
        const result = await response.json();
        assert.equal(result.error.code, code);
        assert.equal(JSON.stringify(result).includes('private'), false);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-powered-by'), null);
      }
      assert.equal(calls, 1);
      assert.deepEqual(await (await fetch(`${base}/health`)).json(), {
        status: 'ok',
      });
      assert.equal((await fetch(`${base}/missing`)).status, 404);
      const unauthenticated = await fetch(`${base}/api/v1/auth/me`);
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.headers.get('www-authenticate'), 'Bearer');
    },
  );
});

test('single-instance rate limiter tracks limits and resets on expiry', () => {
  let now = 0;
  const limiter = new AuthRateLimiter(() => now);
  const middleware = limiter.middleware('test', 2, 1000);
  const request = { ip: '127.0.0.1', socket: {} };
  let allowed = 0;
  middleware(request, {}, () => allowed++);
  middleware(request, {}, () => allowed++);
  assert.throws(() => middleware(request, {}, () => allowed++), {
    code: 'RATE_LIMITED',
    retryAfterSeconds: 1,
  });
  now = 1000;
  middleware(request, {}, () => allowed++);
  assert.equal(allowed, 3);
});
