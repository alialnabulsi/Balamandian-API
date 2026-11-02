import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApp } from '../../dist/app.js';
import { readDatabaseConfig } from '../../dist/config/database.js';
import { ResendMailer } from '../../dist/integrations/email/resend.adapter.js';
import { AuthRepository } from '../../dist/modules/auth/auth.repository.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { hashSessionToken } from '../../dist/modules/auth/auth.security.js';
import { runMigrations } from '../../dist/shared/database/migrations.js';
import {
  createDatabasePool,
  verifyDatabase,
} from '../../dist/shared/database/pool.js';
import { HttpError } from '../../dist/shared/http-error.js';

const { fetch } = globalThis;

const credentials = {
  identifier: 'FICTION001',
  password: 'test-only-sis-password',
};
const identity = { userId: 'FICTION001', email: 'member@example.edu' };

test('authentication integration using mocked SIS/email and a new isolated PostgreSQL database', async (t) => {
  const config = readDatabaseConfig();
  const database = `balamandian_auth_${randomUUID().replaceAll('-', '')}_test`;
  assert.match(database, /^balamandian_auth_[a-f0-9]{32}_test$/);
  assert.notEqual(database, config.database);
  const admin = createDatabasePool(config);
  let pool;
  let created = false;
  t.after(async () => {
    try {
      await pool?.end();
      // Only this run's generated database can ever be dropped. No roles are changed.
      if (
        created &&
        /^balamandian_auth_[a-f0-9]{32}_test$/.test(database) &&
        database !== config.database
      ) {
        await admin.query(`DROP DATABASE "${database}"`);
      }
    } finally {
      await admin.end();
    }
  });
  await verifyDatabase(admin);
  // Identifiers cannot be SQL parameters. This identifier is generated locally and strictly checked above.
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pool = createDatabasePool({ ...config, database });
  await verifyDatabase(pool);
  assert.deepEqual(await runMigrations(pool), ['0001_authentication.sql']);
  assert.deepEqual(await runMigrations(pool), []);
  assert.equal(
    (await pool.query('SELECT current_database() AS name')).rows[0].name,
    database,
  );
  const repository = new AuthRepository(pool);

  async function fixture() {
    // This pool only connects to the generated test database, never the development database.
    await pool.query(
      'TRUNCATE public.app_session, public.pending_registration, public.app_user',
    );
    let now = new Date();
    const emails = [];
    const calls = [];
    let sisError;
    let mailError = false;
    const sis = {
      async verify(input) {
        calls.push(input.identifier);
        if (sisError) throw sisError;
        return identity;
      },
    };
    const mailer = {
      async sendOtp(email, otp) {
        emails.push({ email, otp });
        if (mailError) throw new Error('private email provider diagnostics');
      },
    };
    const options = {
      otpSecret: randomBytes(32).toString('hex'),
      sessionLifetimeSeconds: 604800,
      now: () => now,
    };
    const service = new AuthService(repository, sis, mailer, options);
    return {
      service,
      emails,
      calls,
      sis,
      mailer,
      options,
      advance: (ms) => {
        now = new Date(now.getTime() + ms);
      },
      setSisError: (error) => {
        sisError = error;
      },
      failEmail: () => {
        mailError = true;
      },
      async register() {
        return service.register(credentials);
      },
      async registered() {
        const pending = await service.register(credentials);
        return service.verify(pending.pendingRegistrationId, emails.at(-1).otp);
      },
    };
  }

  await t.test(
    'registration creates no account until OTP, then stores only verifiers and issues a session',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '0',
      );
      assert.equal(f.emails[0].email, identity.email);
      const stored = (
        await pool.query('SELECT * FROM public.pending_registration')
      ).rows[0];
      assert.match(stored.otp_verifier, /^[a-f0-9]{64}$/);
      assert.notEqual(stored.otp_verifier, f.emails[0].otp);
      assert.equal(stored.otp_expires_at - stored.created_at, 600000);
      const result = await f.service.verify(
        pending.pendingRegistrationId,
        f.emails[0].otp,
      );
      assert.equal(result.user.sisUserId, identity.userId);
      assert.equal(result.user.institutionalEmail, identity.email);
      assert.ok(result.user.emailVerifiedAt);
      assert.match(result.user.id, /^[a-f0-9-]{36}$/);
      assert.equal(result.session.tokenType, 'Bearer');
      const session = (await pool.query('SELECT * FROM public.app_session'))
        .rows[0];
      assert.equal(session.token_hash, hashSessionToken(result.session.token));
      assert.equal(session.user_id, result.user.id);
      assert.equal(session.expires_at - session.created_at, 604800000);
      assert.equal(JSON.stringify(result).includes('otpVerifier'), false);
      assert.equal(
        JSON.stringify(stored).includes(credentials.password),
        false,
      );
    },
  );

  await t.test(
    'invalid SIS credentials and outages create neither challenge nor account',
    async () => {
      for (const [status, code] of [
        [401, 'SIS_INVALID_CREDENTIALS'],
        [503, 'SIS_UNAVAILABLE'],
      ]) {
        const f = await fixture();
        f.setSisError(new HttpError(status, code, 'Safe upstream error.'));
        await assert.rejects(f.register(), { code });
        await assert.rejects(f.service.login(credentials), { code });
        assert.equal(f.emails.length, 0);
        assert.equal(
          (await pool.query('SELECT count(*) FROM public.pending_registration'))
            .rows[0].count,
          '0',
        );
      }
    },
  );

  await t.test(
    'existing account returns structured conflict after SIS verification',
    async () => {
      const f = await fixture();
      await f.registered();
      await assert.rejects(f.register(), {
        status: 409,
        code: 'ACCOUNT_EXISTS',
      });
      assert.equal(f.calls.length, 2);
      assert.equal(f.emails.length, 1);
    },
  );

  await t.test(
    'expired OTP cannot create an account but can be replaced by resend',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      f.advance(600000);
      await assert.rejects(
        f.service.verify(pending.pendingRegistrationId, f.emails[0].otp),
        { code: 'OTP_EXPIRED', status: 410 },
      );
      await f.service.resend(pending.pendingRegistrationId);
      await f.service.verify(
        pending.pendingRegistrationId,
        f.emails.at(-1).otp,
      );
    },
  );

  await t.test(
    'incorrect attempts commit persistently, including concurrent submissions and the fifth attempt',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      const wrong = f.emails[0].otp === '000000' ? '000001' : '000000';
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          f.service.verify(pending.pendingRegistrationId, wrong),
        ),
      );
      assert.equal(
        attempts.filter((result) => result.reason?.code === 'OTP_INVALID')
          .length,
        4,
      );
      assert.equal(
        attempts.filter((result) => result.reason?.code === 'OTP_ATTEMPT_LIMIT')
          .length,
        1,
      );
      assert.equal(
        (await repository.findPending(pending.pendingRegistrationId))
          .failedAttempts,
        5,
      );
      await assert.rejects(
        f.service.verify(pending.pendingRegistrationId, f.emails[0].otp),
        { code: 'OTP_ATTEMPT_LIMIT' },
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '0',
      );
    },
  );

  await t.test(
    'successful verification is single use, even with concurrent correct requests',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          f.service.verify(pending.pendingRegistrationId, f.emails[0].otp),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        results.filter(
          (result) => result.reason?.code === 'REGISTRATION_INVALID',
        ).length,
        4,
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '1',
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_session')).rows[0]
          .count,
        '1',
      );
      await assert.rejects(
        f.service.verify(pending.pendingRegistrationId, f.emails[0].otp),
        { code: 'REGISTRATION_INVALID' },
      );
    },
  );

  await t.test(
    'concurrent registrations reserve one pending challenge and send one email',
    async () => {
      const f = await fixture();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => f.register()),
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        results.filter((result) => result.reason?.code === 'OTP_COOLDOWN')
          .length,
        4,
      );
      assert.equal(f.emails.length, 1);
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.pending_registration'))
          .rows[0].count,
        '1',
      );
    },
  );

  await t.test(
    'resend and repeated registration share persistent cooldown and allowance',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      const oldOtp = f.emails[0].otp;
      await assert.rejects(f.service.resend(pending.pendingRegistrationId), {
        code: 'OTP_COOLDOWN',
        retryAfterSeconds: 60,
      });
      await assert.rejects(f.register(), { code: 'OTP_COOLDOWN' });
      f.advance(60000);
      await f.service.resend(pending.pendingRegistrationId);
      assert.notEqual(f.emails.at(-1).otp, oldOtp);
      await assert.rejects(
        f.service.verify(pending.pendingRegistrationId, oldOtp),
        { code: 'OTP_INVALID' },
      );
      for (let i = 0; i < 2; i++) {
        f.advance(60000);
        await f.service.resend(pending.pendingRegistrationId);
      }
      f.advance(60000);
      await assert.rejects(f.service.resend(pending.pendingRegistrationId), {
        code: 'OTP_RESEND_LIMIT',
      });
      await assert.rejects(f.register(), { code: 'OTP_RESEND_LIMIT' });
      assert.equal(f.emails.length, 4);
      f.advance(3600000);
      await assert.rejects(f.service.resend(pending.pendingRegistrationId), {
        code: 'REGISTRATION_INVALID',
      });
      const replacement = await f.register();
      assert.notEqual(
        replacement.pendingRegistrationId,
        pending.pendingRegistrationId,
      );
      assert.equal(
        (await repository.findPending(replacement.pendingRegistrationId))
          .resendCount,
        0,
      );
    },
  );

  await t.test(
    'repeated registration rotates its opaque handle without resetting delivery allowance',
    async () => {
      const f = await fixture();
      const old = await f.register();
      f.advance(60000);
      const latest = await f.register();
      assert.notEqual(old.pendingRegistrationId, latest.pendingRegistrationId);
      assert.equal(
        (await repository.findPending(latest.pendingRegistrationId))
          .resendCount,
        1,
      );
      await assert.rejects(
        f.service.verify(old.pendingRegistrationId, f.emails[0].otp),
        { code: 'REGISTRATION_INVALID' },
      );
      await f.service.verify(latest.pendingRegistrationId, f.emails[1].otp);
    },
  );

  await t.test(
    'email failure fails safely and never activates a challenge',
    async () => {
      const f = await fixture();
      f.failEmail();
      await assert.rejects(f.register(), { code: 'EMAIL_UNAVAILABLE' });
      const pending = (
        await pool.query(
          'SELECT id, delivery_state FROM public.pending_registration',
        )
      ).rows[0];
      assert.equal(pending.delivery_state, 'failed');
      await assert.rejects(f.service.verify(pending.id, f.emails[0].otp), {
        code: 'OTP_UNAVAILABLE',
      });
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '0',
      );
    },
  );

  await t.test(
    'Resend rejection preserves registration/resend errors and persistent delivery limits',
    async () => {
      const f = await fixture();
      let accepted = false;
      let submissions = 0;
      const mailer = new ResendMailer(
        {
          resendApiKey: 're_test_only_api_key',
          resendFromEmail: 'no-reply@example.edu',
          resendTimeoutMs: 5000,
        },
        {
          async send() {
            submissions++;
            return accepted
              ? { data: { id: randomUUID() }, error: null, headers: null }
              : {
                  data: null,
                  error: {
                    name: 'rate_limit_exceeded',
                    statusCode: 429,
                    message: 'private provider diagnostics',
                  },
                  headers: null,
                };
          },
        },
      );
      const service = new AuthService(repository, f.sis, mailer, f.options);
      const expected = {
        status: 503,
        code: 'EMAIL_UNAVAILABLE',
        message:
          'Verification email could not be delivered. Try registration again after the cooldown.',
      };
      await assert.rejects(service.register(credentials), expected);
      let pending = (
        await pool.query('SELECT id FROM public.pending_registration')
      ).rows[0];
      assert.equal(
        (await repository.findPending(pending.id)).deliveryState,
        'failed',
      );
      await assert.rejects(service.register(credentials), {
        code: 'OTP_COOLDOWN',
      });
      assert.equal(submissions, 1);
      f.advance(60000);
      accepted = true;
      pending = await service.register(credentials);
      assert.equal(
        (await repository.findPending(pending.pendingRegistrationId))
          .deliveryState,
        'sent',
      );
      f.advance(60000);
      accepted = false;
      await assert.rejects(
        service.resend(pending.pendingRegistrationId),
        expected,
      );
      const failed = await repository.findPending(
        pending.pendingRegistrationId,
      );
      assert.equal(failed.deliveryState, 'failed');
      assert.equal(failed.resendCount, 2);
      await assert.rejects(
        service.verify(pending.pendingRegistrationId, '000000'),
        { code: 'OTP_UNAVAILABLE' },
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '0',
      );
      assert.equal(submissions, 3);
    },
  );

  await t.test(
    'an unaccepted challenge cannot be verified while email submission is in flight',
    async () => {
      const f = await fixture();
      let release;
      let entered;
      const sending = new Promise((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const service = new AuthService(
        repository,
        f.sis,
        {
          async sendOtp(_email, otp) {
            f.emails.push({ otp });
            entered();
            await blocked;
          },
        },
        f.options,
      );
      const request = service.register(credentials);
      await sending;
      try {
        const id = (
          await pool.query('SELECT id FROM public.pending_registration')
        ).rows[0].id;
        await assert.rejects(service.verify(id, f.emails[0].otp), {
          code: 'OTP_UNAVAILABLE',
        });
      } finally {
        release();
      }
      const pending = await request;
      await service.verify(pending.pendingRegistrationId, f.emails[0].otp);
    },
  );

  await t.test(
    'stale email submission cannot activate a replacement challenge',
    async () => {
      const f = await fixture();
      let release;
      let entered;
      const sending = new Promise((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const slow = new AuthService(
        repository,
        f.sis,
        {
          async sendOtp(_email, otp) {
            f.emails.push({ otp });
            entered();
            await blocked;
          },
        },
        f.options,
      );
      // Attach rejection handling before the replacement can cause the request to reject.
      const oldRequest = assert.rejects(slow.register(credentials), {
        code: 'REGISTRATION_REPLACED',
      });
      await sending;
      f.advance(60000);
      try {
        const latest = await f.register();
        release();
        await oldRequest;
        const pending = await repository.findPending(
          latest.pendingRegistrationId,
        );
        assert.equal(pending.deliveryState, 'sent');
        await f.service.verify(
          latest.pendingRegistrationId,
          f.emails.at(-1).otp,
        );
      } finally {
        release();
      }
    },
  );

  await t.test(
    'user, session and OTP consumption roll back together on database failure',
    async () => {
      const f = await fixture();
      const pending = await f.register();
      const invalidLifetime = new AuthService(repository, f.sis, f.mailer, {
        ...f.options,
        sessionLifetimeSeconds: 0,
      });
      await assert.rejects(
        invalidLifetime.verify(pending.pendingRegistrationId, f.emails[0].otp),
      );
      assert.equal(
        (await pool.query('SELECT count(*) FROM public.app_user')).rows[0]
          .count,
        '0',
      );
      assert.equal(
        (await repository.findPending(pending.pendingRegistrationId))
          .consumedAt,
        null,
      );
      await f.service.verify(pending.pendingRegistrationId, f.emails[0].otp);
    },
  );

  await t.test(
    'login by SIS id or email always verifies SIS and creates separate sessions',
    async () => {
      const f = await fixture();
      const original = await f.registered();
      const byId = await f.service.login(credentials);
      const byEmail = await f.service.login({
        ...credentials,
        identifier: identity.email,
      });
      assert.deepEqual(f.calls, [
        credentials.identifier,
        credentials.identifier,
        identity.email,
      ]);
      assert.equal(byId.user.id, original.user.id);
      assert.equal(byEmail.user.id, original.user.id);
      assert.notEqual(byId.session.token, byEmail.session.token);
    },
  );

  await t.test(
    'missing, disabled and unverified application accounts are rejected',
    async () => {
      const f = await fixture();
      await assert.rejects(f.service.login(credentials), {
        code: 'REGISTRATION_REQUIRED',
      });
      const result = await f.registered();
      await pool.query(
        "UPDATE public.app_user SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [result.user.id],
      );
      await assert.rejects(f.service.login(credentials), {
        code: 'ACCOUNT_DISABLED',
      });
      await assert.rejects(f.service.authenticate(result.session.token), {
        code: 'UNAUTHENTICATED',
      });
      await pool.query(
        'UPDATE public.app_user SET email_verified_at = NULL WHERE id = $1',
        [result.user.id],
      );
      await assert.rejects(f.service.login(credentials), {
        code: 'EMAIL_NOT_VERIFIED',
      });
    },
  );

  await t.test(
    'email alone cannot link an unrelated canonical SIS identity',
    async () => {
      const f = await fixture();
      await f.registered();
      const differentSis = new AuthService(
        repository,
        {
          async verify() {
            return { ...identity, userId: 'FICTION002' };
          },
        },
        f.mailer,
        f.options,
      );
      await assert.rejects(differentSis.login(credentials), {
        code: 'REGISTRATION_REQUIRED',
      });
    },
  );

  await t.test(
    'session restoration, invalid tokens, expiry and logout revoke only the current session',
    async () => {
      const f = await fixture();
      const first = await f.registered();
      const second = await f.service.login(credentials);
      const current = await f.service.authenticate(first.session.token);
      assert.equal(current.user.id, first.user.id);
      await assert.rejects(
        f.service.authenticate(randomBytes(32).toString('base64url')),
        { code: 'UNAUTHENTICATED' },
      );
      await f.service.logout(current.sessionId);
      await assert.rejects(f.service.authenticate(first.session.token), {
        code: 'UNAUTHENTICATED',
      });
      assert.equal(
        (await f.service.authenticate(second.session.token)).user.id,
        first.user.id,
      );
      f.advance(604800000);
      await assert.rejects(f.service.authenticate(second.session.token), {
        code: 'UNAUTHENTICATED',
      });
      assert.equal(f.calls.length, 2); // No SIS calls for restoration or logout.
    },
  );

  await t.test(
    'all six HTTP endpoints expose the documented contracts and statuses',
    async () => {
      const f = await fixture();
      const server = createServer(createApp(f.service));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
      const post = (path, body) =>
        fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      try {
        let response = await post('/register', credentials);
        assert.equal(response.status, 202);
        const pending = (await response.json()).data;
        assert.deepEqual(Object.keys(pending).sort(), [
          'otpExpiresAt',
          'pendingRegistrationId',
          'resendAvailableAt',
        ]);
        response = await post('/register/resend', {
          pendingRegistrationId: pending.pendingRegistrationId,
        });
        assert.equal(response.status, 429);
        assert.equal(response.headers.get('retry-after'), '60');
        f.advance(60000);
        assert.equal(
          (
            await post('/register/resend', {
              pendingRegistrationId: pending.pendingRegistrationId,
            })
          ).status,
          202,
        );
        response = await post('/register/verify', {
          pendingRegistrationId: pending.pendingRegistrationId,
          otp: f.emails.at(-1).otp,
        });
        assert.equal(response.status, 201);
        const registered = (await response.json()).data;
        response = await post('/login', {
          ...credentials,
          identifier: identity.email,
        });
        assert.equal(response.status, 200);
        const loggedIn = (await response.json()).data;
        assert.deepEqual(Object.keys(loggedIn), Object.keys(registered));
        const headers = { Authorization: `Bearer ${loggedIn.session.token}` };
        response = await fetch(`${base}/me`, { headers });
        assert.equal(response.status, 200);
        const restored = (await response.json()).data;
        assert.equal(restored.user.id, registered.user.id);
        assert.equal('token' in restored.session, false);
        response = await fetch(`${base}/logout`, { method: 'POST', headers });
        assert.equal(response.status, 204);
        assert.equal((await fetch(`${base}/me`, { headers })).status, 401);
      } finally {
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
      }
    },
  );
});
