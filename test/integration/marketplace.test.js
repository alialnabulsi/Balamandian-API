import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApp } from '../../dist/app.js';
import { readDatabaseConfig } from '../../dist/config/database.js';
import { AuthRepository } from '../../dist/modules/auth/auth.repository.js';
import { AuthService } from '../../dist/modules/auth/auth.service.js';
import { hashSessionToken } from '../../dist/modules/auth/auth.security.js';
import { MarketplaceRepository } from '../../dist/modules/marketplace/marketplace.repository.js';
import { MarketplaceService } from '../../dist/modules/marketplace/marketplace.service.js';
import { runMigrations } from '../../dist/shared/database/migrations.js';
import {
  createDatabasePool,
  verifyDatabase,
} from '../../dist/shared/database/pool.js';

const { fetch } = globalThis;

test('marketplace integration in a newly generated isolated PostgreSQL 18 database', async (t) => {
  const config = readDatabaseConfig();
  const database = `balamandian_market_${randomUUID().replaceAll('-', '')}_test`;
  assert.match(database, /^balamandian_market_[a-f0-9]{32}_test$/);
  assert.notEqual(database, config.database);
  const admin = createDatabasePool(config);
  let pool;
  let created = false;
  t.after(async () => {
    try {
      await pool?.end();
      if (
        created &&
        /^balamandian_market_[a-f0-9]{32}_test$/.test(database) &&
        database !== config.database
      ) {
        await admin.query(`DROP DATABASE "${database}"`);
      }
    } finally {
      await admin.end();
    }
  });
  await verifyDatabase(admin);
  // Only a generated, validated identifier is interpolated; no request input enters SQL.
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pool = createDatabasePool({ ...config, database });
  await verifyDatabase(pool);
  assert.deepEqual(await runMigrations(pool), [
    '0001_authentication.sql',
    '0002_marketplace.sql',
  ]);
  assert.deepEqual(await runMigrations(pool), []);
  assert.equal(
    (await pool.query('SELECT current_database() AS name')).rows[0].name,
    database,
  );

  // Fixtures are fictional and independent of the development seed.
  let now = new Date();
  const start = new Date(now.getTime() - 10000);
  const future = new Date(now.getTime() + 10000);
  async function category(name, slug, sortOrder = 10, archived = false) {
    return (
      await pool.query(
        `INSERT INTO public.marketplace_category (name, slug, icon_key, sort_order, archived_at)
      VALUES ($1,$2,'shop',$3,CASE WHEN $4 THEN CURRENT_TIMESTAMP END) RETURNING id`,
        [name, slug, sortOrder, archived],
      )
    ).rows[0].id;
  }
  async function place(name, slug, categoryId, archived = false) {
    return (
      await pool.query(
        `INSERT INTO public.marketplace_place
      (name,slug,category_id,description,address,latitude,longitude,archived_at)
      VALUES ($1,$2,$3,'Full fictional description with telescopes','42 Nebula Lane',34.123456,35.654321,
      CASE WHEN $4 THEN CURRENT_TIMESTAMP END) RETURNING id`,
        [name, slug, categoryId, archived],
      )
    ).rows[0].id;
  }
  async function user(label, state = 'active') {
    return (
      await pool.query(
        `INSERT INTO public.app_user (sis_user_id,institutional_email,email_verified_at,status)
      VALUES ($1,$2,CURRENT_TIMESTAMP,$3) RETURNING id`,
        [label, `${label}@example.edu`, state],
      )
    ).rows[0].id;
  }
  async function session(userId, options = {}) {
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO public.app_session (user_id,token_hash,created_at,expires_at,revoked_at)
      VALUES ($1,$2,$3,$4,$5)`,
      [
        userId,
        hashSessionToken(token),
        start,
        options.expired
          ? new Date(now.getTime() - 1)
          : new Date(now.getTime() + 3600000),
        options.revoked ? now : null,
      ],
    );
    return token;
  }
  const goods = await category('Astronomy Goods', 'astronomy-goods');
  const books = await category('Fictional Books', 'fictional-books');
  const later = await category('A Later Category', 'later-category', 20);
  const archivedCategory = await category(
    'Hidden Category',
    'hidden-category',
    0,
    true,
  );
  const alpha = await place('Alpha Observatory', 'alpha-observatory', goods);
  const beta = await place('Beta Store', 'beta-store', books);
  const twin1 = await place('Twin Store', 'twin-one', goods);
  const twin2 = await place('Twin Store', 'twin-two', goods);
  const archivedPlace = await place(
    'Hidden Store',
    'hidden-store',
    goods,
    true,
  );
  const hiddenCategoryPlace = await place(
    'Hidden Category Store',
    'hidden-category-store',
    archivedCategory,
  );
  const first = await user('FICTION_MARKET_A');
  const second = await user('FICTION_MARKET_B');
  const third = await user('FICTION_MARKET_C');
  const disabled = await user('FICTION_MARKET_DISABLED', 'disabled');
  const token = await session(first);
  const secondToken = await session(second);
  const repository = new MarketplaceRepository(pool);
  const service = new MarketplaceService(repository, () => now);
  const auth = new AuthService(
    new AuthRepository(pool),
    {
      verify: () => {
        throw new Error('SIS must never be called by marketplace tests');
      },
    },
    {
      sendOtp: () => {
        throw new Error('Email must never be sent by marketplace tests');
      },
    },
    {
      otpSecret: randomBytes(32).toString('hex'),
      sessionLifetimeSeconds: 3600,
      now: () => now,
    },
  );
  const server = createServer(createApp(auth, service));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/marketplace`;
  async function request(path, options = {}, bearer = token) {
    return fetch(`${base}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${bearer}`, ...options.headers },
    });
  }
  async function get(path, bearer = token) {
    const response = await request(path, {}, bearer);
    assert.equal(response.status, 200, path);
    return (await response.json()).data;
  }

  await t.test(
    'active categories are ordered and expose only their public contract',
    async () => {
      const result = await get('/categories');
      assert.deepEqual(
        result.map((c) => c.id),
        [goods, books, later],
      );
      assert.deepEqual(Object.keys(result[0]).sort(), [
        'iconKey',
        'id',
        'name',
        'slug',
        'sortOrder',
      ]);
    },
  );

  await t.test(
    'search covers full place text and category name/slug, with literal safe input',
    async () => {
      for (const [search, expected] of [
        ['OBSERVATORY', [alpha]],
        ['telescopes', [alpha, beta, twin1, twin2]],
        ['Nebula Lane', [alpha, beta, twin1, twin2]],
        ['Astronomy Goods', [alpha, twin1, twin2]],
        ['astronomy-goods', [alpha, twin1, twin2]],
      ]) {
        const result = await get(
          `/places?search=${encodeURIComponent(search)}`,
        );
        assert.deepEqual(result.items.map((p) => p.id).sort(), expected.sort());
        assert.equal(result.pagination.totalItems, expected.length);
      }
      for (const search of ["' OR 1=1 --", '%', '_']) {
        assert.equal(
          (await get(`/places?search=${encodeURIComponent(search)}`)).items
            .length,
          0,
        );
      }
      const filtered = await get('/places?category=fictional-books');
      assert.deepEqual(
        filtered.items.map((p) => p.id),
        [beta],
      );
      for (const category of ['unknown-category', 'hidden-category']) {
        assert.deepEqual(
          (await get(`/places?category=${category}`)).pagination,
          {
            page: 1,
            limit: 20,
            totalItems: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        );
      }
      assert.equal(
        (await get('/places?category=fictional-books&search=Observatory')).items
          .length,
        0,
      );
    },
  );

  await t.test(
    'stable pagination uses UUID ties, exact totals and supports out-of-range pages',
    async () => {
      const expected = [alpha, beta, ...[twin1, twin2].sort()];
      const ids = [];
      for (let page = 1; page <= 4; page++) {
        const result = await get(`/places?page=${page}&limit=1`);
        assert.equal(result.pagination.totalItems, 4);
        assert.equal(result.pagination.totalPages, 4);
        assert.equal(result.pagination.hasNextPage, page < 4);
        assert.equal(result.pagination.hasPreviousPage, page > 1);
        ids.push(result.items[0].id);
        assert.equal(
          (await get(`/places?page=${page}&limit=1`)).items[0].id,
          ids.at(-1),
        );
      }
      assert.deepEqual(ids, expected);
      const beyond = await get('/places?page=99&limit=1');
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.pagination.totalItems, 4);
    },
  );

  await t.test(
    'favorites are user-owned and insert/delete idempotently, including concurrent requests',
    async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => service.favorite(first, alpha, true)),
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*) FROM public.marketplace_favorite WHERE place_id=$1',
            [alpha],
          )
        ).rows[0].count,
        '1',
      );
      for (const value of [true, true, false, false]) {
        const response = await request(`/places/${alpha}/favorite`, {
          method: value ? 'PUT' : 'DELETE',
        });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, {
          placeId: alpha,
          isFavorite: value,
        });
      }
      await service.favorite(second, beta, true);
      await service.favorite(first, alpha, true);
      assert.equal((await get('/places')).items[0].id, alpha);
      assert.equal((await get('/places', secondToken)).items[0].id, beta);
      assert.equal(
        (await get(`/places/${alpha}`, secondToken)).isFavorite,
        false,
      );
    },
  );

  await t.test(
    'rating creation, replacement, timestamps, removal and concurrent aggregates are exact',
    async () => {
      const initial = await request(`/places/${alpha}/rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"rating":4}',
      });
      assert.equal(initial.status, 200);
      assert.deepEqual((await initial.json()).data, {
        placeId: alpha,
        myRating: 4,
        averageRating: 4,
        ratingCount: 1,
      });
      const before = (
        await pool.query(
          'SELECT created_at,updated_at FROM public.marketplace_rating WHERE user_id=$1 AND place_id=$2',
          [first, alpha],
        )
      ).rows[0];
      now = new Date(now.getTime() + 1000);
      assert.deepEqual(await service.rating(first, alpha, 5), {
        placeId: alpha,
        myRating: 5,
        averageRating: 5,
        ratingCount: 1,
      });
      const after = (
        await pool.query(
          'SELECT created_at,updated_at FROM public.marketplace_rating WHERE user_id=$1 AND place_id=$2',
          [first, alpha],
        )
      ).rows[0];
      assert.equal(after.created_at.getTime(), before.created_at.getTime());
      assert.ok(after.updated_at > before.updated_at);
      await service.rating(first, alpha, 5);
      await service.rating(second, alpha, 2);
      await service.rating(third, alpha, 4);
      const mine = await get(`/places/${alpha}`);
      assert.equal(mine.myRating, 5);
      assert.equal(mine.averageRating, 3.7);
      assert.equal(mine.ratingCount, 3);
      assert.equal((await get(`/places/${alpha}`, secondToken)).myRating, 2);
      for (let i = 0; i < 2; i++) {
        const response = await request(`/places/${alpha}/rating`, {
          method: 'DELETE',
        });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data, {
          placeId: alpha,
          myRating: null,
          averageRating: 3,
          ratingCount: 2,
        });
      }
      await service.rating(second, alpha, null);
      await service.rating(third, alpha, null);
      const concurrent = await Promise.all([
        service.rating(first, twin1, 5),
        service.rating(second, twin1, 1),
        service.rating(third, twin1, 3),
      ]);
      assert.deepEqual(concurrent.map((r) => r.ratingCount).sort(), [1, 2, 3]);
      assert.equal((await get(`/places/${twin1}`)).averageRating, 3);
      for (const id of [first, second, third])
        await service.rating(id, twin1, null);
      assert.deepEqual(await service.rating(first, twin1, null), {
        placeId: twin1,
        myRating: null,
        averageRating: 0,
        ratingCount: 0,
      });
    },
  );

  await t.test(
    'rating timestamps tolerate request clocks arriving out of order',
    async () => {
      const newer = new Date(now.getTime() + 500);
      const older = new Date(now.getTime() - 500);
      await repository.rating(first, twin2, 2, newer);
      await repository.rating(first, twin2, 4, older);
      const stored = (
        await pool.query(
          'SELECT rating,created_at,updated_at FROM public.marketplace_rating WHERE user_id=$1 AND place_id=$2',
          [first, twin2],
        )
      ).rows[0];
      assert.equal(stored.rating, 4);
      assert.equal(stored.created_at.toISOString(), newer.toISOString());
      assert.equal(stored.updated_at.toISOString(), newer.toISOString());
      await service.rating(first, twin2, null);
    },
  );

  await t.test(
    'favorites precede averages; averages precede names with per-user rating projections',
    async () => {
      await service.rating(first, beta, 5);
      await service.rating(second, twin1, 4);
      await service.rating(third, twin1, 5);
      const result = await get('/places');
      assert.deepEqual(
        result.items.map((p) => p.id),
        [alpha, beta, twin1, twin2],
      );
      assert.deepEqual(
        result.items.map((p) => p.averageRating),
        [0, 5, 4.5, 0],
      );
      assert.deepEqual(
        result.items.map((p) => p.myRating),
        [null, 5, null, null],
      );
      assert.deepEqual(
        result.items.map((p) => p.ratingCount),
        [0, 1, 2, 0],
      );
      const other = await get('/places', secondToken);
      assert.equal(other.items[0].id, beta);
      assert.equal(other.items.find((p) => p.id === twin1).myRating, 4);
    },
  );

  await t.test(
    'detail converts coordinates, orders independent child collections and avoids aggregate multiplication',
    async () => {
      for (const [sort, alt] of [
        [2, 'Second'],
        [0, 'First'],
      ])
        await pool.query(
          `INSERT INTO public.marketplace_place_image (place_id,image_url,alternative_text,sort_order) VALUES ($1,$2,$3,$4)`,
          [beta, `https://example.invalid/${sort}.jpg`, alt, sort],
        );
      for (const [day, opens, closes] of [
        [2, '09:00', '19:00'],
        [1, '13:00', '17:00'],
        [1, '07:30', '12:00'],
        [1, '07:30', '11:00'],
      ])
        await pool.query(
          `INSERT INTO public.marketplace_opening_hour (place_id,day_of_week,opens_at,closes_at) VALUES ($1,$2,$3,$4)`,
          [beta, day, opens, closes],
        );
      const detail = await get(`/places/${beta}`);
      assert.equal(detail.latitude, 34.123456);
      assert.equal(detail.longitude, 35.654321);
      assert.equal(detail.coverImageUrl, null);
      assert.equal(detail.timezone, 'Asia/Beirut');
      for (const key of [
        'googleMapsUrl',
        'phoneNumber',
        'websiteUrl',
        'socialUrl',
      ])
        assert.equal(detail[key], null);
      assert.deepEqual(
        detail.images.map((i) => i.alternativeText),
        ['First', 'Second'],
      );
      assert.deepEqual(detail.openingHours, [
        { dayOfWeek: 1, opensAt: '07:30', closesAt: '11:00' },
        { dayOfWeek: 1, opensAt: '07:30', closesAt: '12:00' },
        { dayOfWeek: 1, opensAt: '13:00', closesAt: '17:00' },
        { dayOfWeek: 2, opensAt: '09:00', closesAt: '19:00' },
      ]);
      assert.equal(detail.ratingCount, 1);
      assert.equal(detail.averageRating, 5);
      for (const key of [
        'created_at',
        'updated_at',
        'archived_at',
        'createdAt',
        'updatedAt',
        'archivedAt',
        'isOpenNow',
        'search_document',
      ])
        assert.equal(key in detail, false);
      const empty = await get(`/places/${twin2}`);
      assert.deepEqual(empty.images, []);
      assert.deepEqual(empty.openingHours, []);
      await pool.query(
        'UPDATE public.marketplace_place SET latitude=NULL,longitude=NULL WHERE id=$1',
        [twin2],
      );
      assert.equal((await get(`/places/${twin2}`)).latitude, null);
    },
  );

  let visiblePosts;
  await t.test(
    'scheduled posts hide future, expired and archived records, places and categories',
    async () => {
      async function post(
        placeId,
        type,
        startsAt,
        endsAt = null,
        archived = false,
      ) {
        return (
          await pool.query(
            `INSERT INTO public.marketplace_place_post (place_id,post_type,title,body,starts_at,ends_at,archived_at)
        VALUES ($1,$2,'Fictional bulletin','Complete fictional body',$3,$4,CASE WHEN $5 THEN CURRENT_TIMESTAMP END) RETURNING id`,
            [placeId, type, startsAt, endsAt, archived],
          )
        ).rows[0].id;
      }
      const older = await post(alpha, 'news', start);
      const newer = await post(beta, 'news', now);
      const tied = await post(beta, 'advertisement', now);
      const bounded = await post(twin2, 'news', start, future);
      visiblePosts = [older, ...[newer, tied].sort().reverse(), bounded];
      await post(beta, 'news', future);
      await post(beta, 'news', start, now);
      await post(beta, 'news', start, null, true);
      await post(archivedPlace, 'news', start);
      await post(hiddenCategoryPlace, 'advertisement', start);
      const result = await get('/posts');
      assert.deepEqual(
        result.items.map((p) => p.id),
        visiblePosts,
      );
      assert.equal(result.pagination.totalItems, 4);
      assert.equal(result.items[0].isFavoritePlace, true);
      assert.equal(result.items[0].startsAt, start.toISOString());
      assert.equal(result.items[0].endsAt, null);
      assert.equal(result.items[0].imageUrl, null);
      assert.deepEqual(Object.keys(result.items[0]).sort(), [
        'body',
        'endsAt',
        'id',
        'imageUrl',
        'isFavoritePlace',
        'place',
        'startsAt',
        'title',
        'type',
      ]);
      assert.deepEqual(Object.keys(result.items[0].place).sort(), [
        'coverImageUrl',
        'id',
        'name',
        'slug',
      ]);
      assert.equal((await get('/posts', secondToken)).items[0].place.id, beta);
      assert.equal((await get('/posts?type=advertisement')).items.length, 1);
      assert.equal((await get(`/posts?placeId=${alpha}`)).items.length, 1);
      assert.equal(
        (await get(`/posts?placeId=${alpha}&type=advertisement`)).items.length,
        0,
      );
      assert.equal(
        (await get(`/posts?placeId=${randomUUID()}`)).items.length,
        0,
      );
      const paged = [];
      for (let page = 1; page <= 4; page++) {
        const result = await get(`/posts?limit=1&page=${page}`);
        paged.push(result.items[0].id);
        assert.equal(result.pagination.totalItems, 4);
      }
      assert.deepEqual(paged, visiblePosts);
      assert.equal(
        (await get('/posts?page=99&limit=1')).pagination.totalItems,
        4,
      );
      now = new Date(future);
      const changed = await get('/posts');
      assert.equal(
        changed.items.some((p) => p.id === bounded),
        false,
      );
      assert.equal(changed.items.length, 4);
    },
  );

  await t.test(
    'unknown and archived places cannot be read or mutated, including archived categories',
    async () => {
      for (const id of [randomUUID(), archivedPlace, hiddenCategoryPlace]) {
        for (const [method, path, body] of [
          ['GET', `/places/${id}`],
          ['PUT', `/places/${id}/favorite`],
          ['DELETE', `/places/${id}/favorite`],
          ['PUT', `/places/${id}/rating`, '{"rating":4}'],
          ['DELETE', `/places/${id}/rating`],
        ]) {
          const response = await request(path, {
            method,
            body,
            headers: body ? { 'Content-Type': 'application/json' } : {},
          });
          assert.equal(response.status, 404);
          assert.deepEqual(await response.json(), {
            error: {
              code: 'PLACE_NOT_FOUND',
              message: 'This place is unavailable.',
            },
          });
        }
      }
      await pool.query(
        'UPDATE public.marketplace_place SET archived_at=CURRENT_TIMESTAMP WHERE id=$1',
        [alpha],
      );
      assert.equal(
        (await get('/places')).items.some((p) => p.id === alpha),
        false,
      );
      assert.equal(
        (await get('/posts')).items.some((p) => p.place.id === alpha),
        false,
      );
      await assert.rejects(service.favorite(first, alpha, false), {
        code: 'PLACE_NOT_FOUND',
      });
      await assert.rejects(service.rating(first, alpha, 4), {
        code: 'PLACE_NOT_FOUND',
      });
    },
  );

  await t.test(
    'missing, malformed, unknown, expired, revoked and disabled sessions remain unauthorized',
    async () => {
      const tokens = [
        '',
        'malformed',
        randomBytes(32).toString('base64url'),
        await session(first, { expired: true }),
        await session(first, { revoked: true }),
        await session(disabled),
      ];
      for (const bearer of tokens) {
        for (const [method, path] of [
          ['GET', '/categories'],
          ['GET', '/places'],
          ['GET', `/places/${beta}`],
          ['GET', '/posts'],
          ['PUT', `/places/${beta}/favorite`],
          ['DELETE', `/places/${beta}/favorite`],
          ['PUT', `/places/${beta}/rating`],
          ['DELETE', `/places/${beta}/rating`],
        ]) {
          const response = await request(path, { method }, bearer);
          assert.equal(response.status, 401);
          assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
        }
      }
      const response = await fetch(`${base}/categories`);
      assert.equal(response.status, 401);
      await auth.logout((await auth.authenticate(token)).sessionId);
      assert.equal((await request('/categories')).status, 401);
    },
  );
});
