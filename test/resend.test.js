import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import test from 'node:test';
import { clearTimeout, setTimeout } from 'node:timers';

import { ResendMailer } from '../dist/integrations/email/resend.adapter.js';

const { Response, ReadableStream } = globalThis;
const config = {
  resendApiKey: 're_test_only_api_key',
  resendFromEmail: 'no-reply@example.edu',
  resendTimeoutMs: 5000,
};
const recipient = 'member@example.edu';
const otp = '004281';
const emailId = 'dce987fe-bc40-4ca8-bd1d-288eb3f71872';
const safeMessage = 'Email provider did not accept the verification message.';

function assertSafeFailure(error) {
  assert.equal(error.message, safeMessage);
  assert.equal(error.cause, undefined);
  return true;
}

test('Resend SDK submits the unchanged OTP email to its fixed HTTPS API exactly once', async (t) => {
  const previousBaseUrl = process.env.RESEND_BASE_URL;
  process.env.RESEND_BASE_URL = 'http://unexpected.invalid';
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.RESEND_BASE_URL;
    else process.env.RESEND_BASE_URL = previousBaseUrl;
  });
  const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    assert.equal(
      options.headers.get('Authorization'),
      `Bearer ${config.resendApiKey}`,
    );
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body), {
      from: config.resendFromEmail,
      to: recipient,
      subject: 'Your Balamandian verification code',
      text: `Your Balamandian verification code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
    });
    return Response.json({ id: emailId });
  });
  assert.equal(
    await new ResendMailer(config).sendOtp(recipient, otp),
    undefined,
  );
  assert.equal(request.mock.callCount(), 1);
});

test('Resend API rejections fail safely without retries or sensitive provider logs', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  for (const [status, name] of [
    [401, 'invalid_api_key'],
    [403, 'validation_error'],
    [422, 'validation_error'],
    [429, 'rate_limit_exceeded'],
    [500, 'application_error'],
    [503, 'service_unavailable'],
  ]) {
    const request = t.mock.method(globalThis, 'fetch', async () =>
      Response.json(
        {
          statusCode: status,
          name,
          message: `Private provider details ${config.resendApiKey} ${recipient} ${otp}`,
        },
        { status },
      ),
    );
    await assert.rejects(
      new ResendMailer(config).sendOtp(recipient, otp),
      assertSafeFailure,
    );
    assert.equal(request.mock.callCount(), 1);
    request.mock.restore();
  }
  assert.equal(log.mock.callCount(), 0);
});

test('malformed or missing Resend acceptance IDs never count as successful submission', async (t) => {
  for (const payload of [null, [], {}, { id: '' }, { id: ' ' }, { id: 123 }]) {
    const request = t.mock.method(globalThis, 'fetch', async () =>
      Response.json(payload),
    );
    await assert.rejects(
      new ResendMailer(config).sendOtp(recipient, otp),
      assertSafeFailure,
    );
    request.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('not-json'));
  await assert.rejects(
    new ResendMailer(config).sendOtp(recipient, otp),
    assertSafeFailure,
  );
});

test('unexpected SDK results and thrown exceptions cannot bypass acceptance checks or expose their cause', async () => {
  for (const result of [
    undefined,
    null,
    [],
    {},
    { data: { id: emailId } },
    { data: { id: emailId }, error: { message: otp } },
  ]) {
    const mailer = new ResendMailer(config, {
      async send() {
        return result;
      },
    });
    await assert.rejects(mailer.sendOtp(recipient, otp), assertSafeFailure);
  }
  const mailer = new ResendMailer(config, {
    async send() {
      throw new Error(`Private SDK exception ${config.resendApiKey} ${otp}`);
    },
  });
  await assert.rejects(mailer.sendOtp(recipient, otp), assertSafeFailure);
});

test('Resend network errors do not retry or expose exception details', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const request = t.mock.method(globalThis, 'fetch', () =>
    Promise.reject(new Error(`Private network details ${recipient} ${otp}`)),
  );
  await assert.rejects(
    new ResendMailer(config).sendOtp(recipient, otp),
    assertSafeFailure,
  );
  assert.equal(request.mock.callCount(), 1);
  assert.equal(log.mock.callCount(), 0);
});

test('Resend deadline aborts a stalled SDK request without retrying', async (t) => {
  let signal;
  const request = t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      new ResendMailer({ ...config, resendTimeoutMs: 15 }).sendOtp(
        recipient,
        otp,
      ),
      assertSafeFailure,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(signal.aborted, true);
  assert.equal(request.mock.callCount(), 1);
});

test('Resend deadline also bounds response body consumption', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener(
            'abort',
            () => controller.error(signal.reason),
            { once: true },
          );
        },
      }),
    );
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      new ResendMailer({ ...config, resendTimeoutMs: 15 }).sendOtp(
        recipient,
        otp,
      ),
      assertSafeFailure,
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(signal.aborted, true);
});

test('a late acceptance after the deadline remains a failure', async () => {
  const mailer = new ResendMailer(
    { ...config, resendTimeoutMs: 5 },
    {
      async send() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { data: { id: emailId }, error: null, headers: null };
      },
    },
  );
  await assert.rejects(mailer.sendOtp(recipient, otp), assertSafeFailure);
});
