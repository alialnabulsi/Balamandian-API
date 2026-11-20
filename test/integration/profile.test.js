import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { createApp } from '../../dist/app.js';
import { readDatabaseConfig } from '../../dist/config/database.js';
import { createDatabasePool } from '../../dist/shared/database/pool.js';
import { runMigrations } from '../../dist/shared/database/migrations.js';
import { AuthRepository } from '../../dist/modules/auth/auth.repository.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { hashSessionToken } from '../../dist/modules/auth/auth.security.js';
import { ProfileRepository } from '../../dist/modules/profile/profile.repository.js';
import { ProfileService } from '../../dist/modules/profile/profile.service.js';
import { createMarketplaceDependencies } from '../../dist/modules/marketplace/marketplace.composition.js';

const { fetch } = globalThis;
const identity = {
  userId: 'FICT001',
  email: 'fiction@example.edu',
  firstName: 'John',
  lastName: 'Smith',
  roles: ['student', 'instructor'],
  academic: {
    campus: 'Main',
    admissionYear: 2022,
    programs: [
      { name: 'Computing', department: 'Computing', faculty: 'Science' },
    ],
    departments: [],
  },
};
test('profile upgrade, signup, hydration, avatars and social API in an isolated database', async (t) => {
  const config = readDatabaseConfig(),
    database = `balamandian_profile_${randomUUID().replaceAll('-', '')}_test`;
  assert.match(database, /^balamandian_profile_[a-f0-9]{32}_test$/);
  assert.notEqual(database, config.database);
  const admin = createDatabasePool(config);
  let pool,
    server,
    created = false;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await pool?.end();
    try {
      if (
        created &&
        /^balamandian_profile_[a-f0-9]{32}_test$/.test(database) &&
        database !== config.database
      )
        await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pool = createDatabasePool({ ...config, database });
  const dir = await mkdtemp(join(tmpdir(), 'profile-upgrade-'));
  try {
    for (const name of ['0001_authentication.sql', '0002_marketplace.sql'])
      await copyFile(
        new URL(`../../database/migrations/${name}`, import.meta.url),
        join(dir, name),
      );
    await runMigrations(pool, pathToFileURL(`${dir}/`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const legacy = (
    await pool.query(
      `INSERT INTO public.app_user(sis_user_id,institutional_email,email_verified_at) VALUES ('LEGACY','verified@example.edu',CURRENT_TIMESTAMP) RETURNING id`,
    )
  ).rows[0].id;
  const legacyToken = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO public.app_session(user_id,token_hash,expires_at) VALUES ($1,$2,CURRENT_TIMESTAMP+interval '1 day')`,
    [legacy, hashSessionToken(legacyToken)],
  );
  const category = (
    await pool.query(
      `INSERT INTO public.marketplace_category(name,slug,icon_key) VALUES ('Fictional category','fictional-category','shop') RETURNING id`,
    )
  ).rows[0].id;
  const place = (
    await pool.query(
      `INSERT INTO public.marketplace_place(category_id,name,slug,description,address) VALUES ($1,'Fictional cafe','fictional-cafe','Fictional description','Fictional address') RETURNING id`,
      [category],
    )
  ).rows[0].id;
  await pool.query(
    'INSERT INTO public.marketplace_favorite(user_id,place_id) VALUES ($1,$2)',
    [legacy, place],
  );
  await pool.query(
    'INSERT INTO public.marketplace_rating(user_id,place_id,rating) VALUES ($1,$2,4)',
    [legacy, place],
  );
  assert.deepEqual(await runMigrations(pool), ['0003_user_profile.sql']);
  assert.equal(
    (
      await pool.query(
        'SELECT rating FROM public.marketplace_rating WHERE user_id=$1',
        [legacy],
      )
    ).rows[0].rating,
    4,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*) FROM public.marketplace_favorite WHERE user_id=$1',
        [legacy],
      )
    ).rows[0].count,
    '1',
  );
  assert.deepEqual(await runMigrations(pool), []);
  assert.equal(
    (await pool.query('SELECT count(*) FROM public.app_session')).rows[0].count,
    '1',
  );
  const authRepo = new AuthRepository(pool),
    profileRepo = new ProfileRepository(pool);
  let memberCalls = 0,
    offline = false,
    otp;
  const sis = {
    verify: async () => identity,
    member: async (id) => {
      memberCalls++;
      if (offline) throw Error('offline');
      return { ...identity, userId: id, email: 'changed@example.edu' };
    },
  };
  const auth = new AuthService(
    authRepo,
    sis,
    {
      sendOtp: async (_email, code) => {
        otp = code;
      },
    },
    {
      otpSecret: randomBytes(32).toString('hex'),
      sessionLifetimeSeconds: 86400,
    },
  );
  const profile = new ProfileService(profileRepo, sis);
  server = createServer(
    createApp(auth, createMarketplaceDependencies(pool).service, profile),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = async (
    path,
    token = legacyToken,
    method = 'GET',
    body,
    contentType = 'application/json',
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': contentType } : {}),
      },
      ...(body !== undefined
        ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
        : {}),
    });
    return {
      status: response.status,
      data: response.headers.get('content-type')?.startsWith('image/')
        ? Buffer.from(await response.arrayBuffer())
        : await response.json(),
    };
  };
  await t.test(
    'legacy hydration recovers without expiring the session or replacing verified email',
    async () => {
      offline = true;
      assert.equal((await request('/profile/me')).status, 503);
      assert.ok(await auth.authenticate(legacyToken));
      offline = false;
      const results = await Promise.all([
        request('/profile/me'),
        request('/profile/me'),
      ]);
      assert.equal(results[0].status, 200);
      assert.equal(
        results[0].data.data.account.institutionalEmail,
        'verified@example.edu',
      );
      assert.equal(memberCalls, 2);
      await request('/profile/me');
      assert.equal(memberCalls, 2);
    },
  );
  let signed;
  await t.test(
    'OTP atomically persists profile, consumes snapshot and creates session; no account before OTP',
    async () => {
      const pending = await auth.register({
        identifier: 'FICT001',
        password: 'not-persisted',
      });
      assert.equal(
        (
          await pool.query(
            `SELECT count(*) FROM public.app_user WHERE sis_user_id='FICT001'`,
          )
        ).rows[0].count,
        '0',
      );
      signed = await auth.verify(pending.pendingRegistrationId, otp);
      assert.equal(
        (
          await profile.own(
            (await auth.authenticate(signed.session.token)).user,
          )
        ).username,
        'john.smith2',
      );
      await assert.rejects(auth.verify(pending.pendingRegistrationId, otp), {
        code: 'REGISTRATION_INVALID',
      });
    },
  );
  await t.test(
    'concurrent duplicate-name allocations use unique stable suffixes',
    async () => {
      const ids = [];
      for (let i = 0; i < 6; i++)
        ids.push(
          (
            await pool.query(
              `INSERT INTO public.app_user(sis_user_id,institutional_email,email_verified_at) VALUES ($1,'fiction@example.edu',CURRENT_TIMESTAMP) RETURNING id`,
              [`DUP${i}`],
            )
          ).rows[0].id,
        );
      await Promise.all(ids.map((id) => profileRepo.hydrate(id, identity)));
      const names = await pool.query(
        `SELECT username FROM public.user_profile`,
      );
      assert.equal(new Set(names.rows.map((r) => r.username)).size, 8);
      await profileRepo.hydrate(ids[0], { ...identity, firstName: 'Changed' });
      assert.equal((await profileRepo.own(ids[0])).displayName, 'John Smith');
    },
  );
  await t.test(
    'owner-only information, strict edit allowlist and authenticated endpoints',
    async () => {
      assert.equal((await request('/profile/me', null)).status, 401);
      for (const path of [
        `/users/${legacy}/profile`,
        `/users/${legacy}/avatar`,
        `/users/${legacy}/followers`,
        `/users`,
      ])
        assert.equal((await request(path, null)).status, 401);
      const publicProfile = (
        await request(`/users/${legacy}/profile`, signed.session.token)
      ).data.data;
      for (const field of [
        'account',
        'sisId',
        'institutionalEmail',
        'academic',
        'emailVerifiedAt',
        'createdAt',
      ])
        assert.equal(field in publicProfile, false);
      for (const body of [
        { biography: 'ok', username: 'attack' },
        { biography: 'a'.repeat(251) },
        { firstName: 'attack' },
      ])
        assert.equal(
          (await request('/profile/me', legacyToken, 'PATCH', body)).status,
          400,
        );
      assert.equal(
        (
          await request('/profile/me', legacyToken, 'PATCH', {
            biography: 'Hello campus',
          })
        ).data.data.biography,
        'Hello campus',
      );
    },
  );
  await t.test(
    'follow idempotence, counts, search, pagination, self and disabled target protections',
    async () => {
      const path = `/users/${signed.user.id}/follow`;
      await Promise.all([
        request(path, legacyToken, 'PUT'),
        request(path, legacyToken, 'PUT'),
      ]);
      const target = (await request(`/users/${signed.user.id}/profile`)).data
        .data;
      assert.equal(target.followersCount, 1);
      assert.equal(target.isFollowing, true);
      const following = await request(`/users/${legacy}/following`);
      assert.equal(following.data.data.items[0].id, signed.user.id);
      assert.equal(
        (await request(`/users/${legacy}/follow`, legacyToken, 'PUT')).status,
        400,
      );
      const followers = await request(
        `/users/${signed.user.id}/followers?search=john&limit=1`,
      );
      assert.equal(followers.data.data.items.length, 1);
      assert.equal(followers.data.data.total, 1);
      assert.equal('account' in followers.data.data.items[0], false);
      assert.equal((await request('/users?limit=1')).data.data.hasMore, true);
      assert.equal(
        (await request('/users?page=999')).data.data.items.length,
        0,
      );
      await request(path, legacyToken, 'DELETE');
      await request(path, legacyToken, 'DELETE');
      assert.equal(
        (await request(`/users/${signed.user.id}/profile`)).data.data
          .followersCount,
        0,
      );
      await pool.query(
        `UPDATE public.app_user SET status='disabled' WHERE id=$1`,
        [signed.user.id],
      );
      assert.equal((await request(path, legacyToken, 'PUT')).status, 404);
      await pool.query(
        `UPDATE public.app_user SET status='active' WHERE id=$1`,
        [signed.user.id],
      );
    },
  );
  await t.test(
    'avatar upload/replacement/version, retrieval, validation and owner-only removal',
    async () => {
      const bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer();
      const a = await request(
        '/profile/me/avatar',
        legacyToken,
        'PUT',
        bytes,
        'image/png',
      );
      assert.equal(a.status, 200);
      const first = a.data.data.avatarPath;
      assert.equal((await request(first.replace('/api/v1', ''))).status, 200);
      const b = await request(
        '/profile/me/avatar',
        legacyToken,
        'PUT',
        bytes,
        'image/png',
      );
      assert.notEqual(b.data.data.avatarPath, first);
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) FROM public.user_avatar WHERE user_id=$1',
            [legacy],
          )
        ).rows[0].count,
        '1',
      );
      assert.equal(
        (
          await request(
            '/profile/me/avatar',
            legacyToken,
            'PUT',
            Buffer.from('bad'),
            'image/png',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            '/profile/me/avatar',
            legacyToken,
            'PUT',
            Buffer.from('<svg/>'),
            'image/svg+xml',
          )
        ).status,
        415,
      );
      assert.equal(
        (
          await request(
            `/users/${legacy}/avatar`,
            signed.session.token,
            'DELETE',
          )
        ).status,
        404,
      );
      assert.equal(
        (await request('/profile/me/avatar', legacyToken, 'DELETE')).data.data
          .avatarPath,
        null,
      );
      assert.equal((await request(`/users/${legacy}/avatar`)).status, 404);
    },
  );
  await t.test(
    'legacy pending challenge fails safely until credentials are verified again',
    async () => {
      const pending = await auth
        .register({ ...identity, identifier: 'FICT001', password: 'fiction' })
        .catch(() => null);
      assert.equal(pending, null);
      // A new identity with no snapshot represents an old pending record, never an active account.
      const freshSis = {
        ...sis,
        verify: async () => ({ ...identity, userId: 'OLD_PENDING' }),
      };
      const oldAuth = new AuthService(
        authRepo,
        freshSis,
        {
          sendOtp: async (_e, c) => {
            otp = c;
          },
        },
        {
          otpSecret: randomBytes(32).toString('hex'),
          sessionLifetimeSeconds: 86400,
        },
      );
      const registration = await oldAuth.register({
        identifier: 'OLD_PENDING',
        password: 'fiction',
      });
      await pool.query(
        'UPDATE public.pending_registration SET identity_snapshot=NULL WHERE id=$1',
        [registration.pendingRegistrationId],
      );
      await assert.rejects(
        oldAuth.verify(registration.pendingRegistrationId, otp),
        { code: 'REGISTRATION_INVALID' },
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*) FROM public.app_user WHERE sis_user_id='OLD_PENDING'`,
          )
        ).rows[0].count,
        '0',
      );
    },
  );
});
