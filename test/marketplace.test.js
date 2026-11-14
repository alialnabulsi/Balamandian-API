import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApp } from '../dist/app.js';
import { MarketplaceRateLimiter } from '../dist/modules/marketplace/marketplace.middleware.js';
import { MarketplaceRepository } from '../dist/modules/marketplace/marketplace.repository.js';
import { MarketplaceService } from '../dist/modules/marketplace/marketplace.service.js';
import * as validators from '../dist/modules/marketplace/marketplace.validators.js';
import { HttpError } from '../dist/shared/http-error.js';

const { fetch } = globalThis;
const userId = randomUUID();
const placeId = randomUUID();
const token = 'A'.repeat(43);
const invalid = { status: 400, code: 'VALIDATION_ERROR' };

function memoryRepository() {
  const favorites = new Set();
  const ratings = new Map();
  return {
    async categories() {
      return [];
    },
    async places() {
      return { items: [], totalItems: 0 };
    },
    async posts() {
      return { items: [], totalItems: 0 };
    },
    async place(_user, id) {
      return id === placeId ? { id } : undefined;
    },
    async favorite(user, id, value) {
      if (id !== placeId) return undefined;
      const key = `${user}:${id}`;
      if (value) favorites.add(key);
      else favorites.delete(key);
      return { placeId: id, isFavorite: favorites.has(key) };
    },
    async rating(user, id, value) {
      if (id !== placeId) return undefined;
      if (value === null) ratings.delete(user);
      else ratings.set(user, value);
      const values = [...ratings.values()];
      return {
        placeId: id,
        myRating: ratings.get(user) ?? null,
        averageRating: values.length
          ? Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 10,
            ) / 10
          : 0,
        ratingCount: values.length,
      };
    },
  };
}

async function http(t, service = new MarketplaceService(memoryRepository())) {
  let authentications = 0;
  const auth = {
    async authenticate(value) {
      authentications++;
      if (value !== token)
        throw new HttpError(
          401,
          'UNAUTHENTICATED',
          'A valid application session is required.',
        );
      return { user: { id: userId } };
    },
  };
  const server = createServer(createApp(auth, service));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    request: (path, options = {}) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/api/marketplace${path}`,
        {
          ...options,
          headers: { Authorization: `Bearer ${token}`, ...options.headers },
        },
      ),
    authentications: () => authentications,
  };
}

test('strict place queries reject unknown keys, arrays, types, malformed numbers and empty search', () => {
  assert.deepEqual(validators.places({}), { page: 1, limit: 20 });
  assert.deepEqual(
    validators.places({
      search: '  Observatory  ',
      category: 'fictional-goods',
      page: '2',
      limit: '50',
    }),
    { page: 2, limit: 50, search: 'Observatory', category: 'fictional-goods' },
  );
  for (const query of [
    null,
    [],
    'text',
    { userId },
    { search: ['a'] },
    { search: '' },
    { search: '   ' },
    { search: 'a'.repeat(101) },
    { search: 12 },
    { search: 'a\0b' },
    { category: '' },
    { category: 'Bad Slug' },
    { category: ['goods'] },
    { category: 'a'.repeat(81) },
  ])
    assert.throws(() => validators.places(query), invalid);
  for (const key of ['page', 'limit']) {
    for (const value of [
      '0',
      '-1',
      '1.5',
      '01',
      '+1',
      '1e2',
      '1 ',
      '',
      'NaN',
      'Infinity',
      '9007199254740992',
      [],
      1,
    ]) {
      assert.throws(() => validators.places({ [key]: value }), invalid);
    }
  }
  assert.throws(() => validators.places({ limit: '51' }), invalid);
  assert.throws(
    () => validators.places({ page: '9007199254740991', limit: '50' }),
    invalid,
  );
});

test('strict post queries and UUID validation', () => {
  assert.deepEqual(validators.posts({}), { page: 1, limit: 20 });
  assert.deepEqual(
    validators.posts({ type: 'news', placeId: placeId.toUpperCase() }),
    { page: 1, limit: 20, type: 'news', placeId },
  );
  assert.equal(
    validators.posts({ type: 'advertisement' }).type,
    'advertisement',
  );
  for (const query of [
    { search: 'a' },
    { type: 'News' },
    { type: ['news'] },
    { placeId: 'invalid' },
    { page: '0' },
    { limit: '51' },
    { placeId: [placeId] },
    { type: null },
  ]) {
    assert.throws(() => validators.posts(query), invalid);
  }
  for (const value of [
    null,
    1,
    [],
    '',
    'bad',
    `${placeId} `,
    placeId.replaceAll('-', ''),
  ])
    assert.throws(() => validators.placeId(value), invalid);
  assert.equal(validators.placeId(placeId.toUpperCase()), placeId);
});

test('rating body accepts exactly one integer rating from 1 through 5', () => {
  for (let rating = 1; rating <= 5; rating++)
    assert.equal(validators.rating({ rating }), rating);
  for (const value of [
    null,
    [],
    {},
    4,
    { rating: 0 },
    { rating: 6 },
    { rating: 2.5 },
    { rating: '4' },
    { rating: null },
    { rating: NaN },
    { rating: 4, userId },
    { rating: 4, extra: true },
  ]) {
    assert.throws(() => validators.rating(value), invalid);
  }
});

test('service maps unavailable places to safe errors and preserves favorite and rating behavior', async () => {
  const service = new MarketplaceService(memoryRepository());
  const absent = randomUUID();
  for (const operation of [
    () => service.place(userId, absent),
    () => service.favorite(userId, absent, true),
    () => service.favorite(userId, absent, false),
    () => service.rating(userId, absent, 4),
    () => service.rating(userId, absent, null),
  ]) {
    await assert.rejects(operation(), {
      status: 404,
      code: 'PLACE_NOT_FOUND',
      message: 'This place is unavailable.',
    });
  }
  for (const value of [true, true, false, false])
    assert.deepEqual(await service.favorite(userId, placeId, value), {
      placeId,
      isFavorite: value,
    });
  for (const value of [4, 5, 5, null, null])
    assert.deepEqual(await service.rating(userId, placeId, value), {
      placeId,
      myRating: value,
      averageRating: value ?? 0,
      ratingCount: value === null ? 0 : 1,
    });
  assert.deepEqual(
    (await service.places(userId, { page: 3, limit: 20 })).pagination,
    {
      page: 3,
      limit: 20,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: true,
    },
  );
});

test('clock dependency controls scheduled post queries and rating timestamps', async () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const repo = memoryRepository();
  repo.posts = async (user, query, date) => {
    assert.equal(user, userId);
    assert.equal(date, now);
    assert.equal(query.page, 1);
    return { items: [], totalItems: 0 };
  };
  repo.rating = async (_user, _id, _rating, date) => {
    assert.equal(date, now);
    return { placeId, myRating: 4, averageRating: 4, ratingCount: 1 };
  };
  const service = new MarketplaceService(repo, () => now);
  await service.posts(userId, { page: 1, limit: 20 });
  await service.rating(userId, placeId, 4);
});

test('mutation limiter allows 60 per internal user, expires, reclaims and fails closed at 10000 entries', () => {
  let now = 0;
  const middleware = new MarketplaceRateLimiter(() => now).middleware();
  const response = (id) => ({ locals: { auth: { user: { id } } } });
  let allowed = 0;
  const next = () => allowed++;
  for (let i = 0; i < 60; i++) middleware({}, response(userId), next);
  assert.throws(() => middleware({}, response(userId), next), {
    status: 429,
    code: 'RATE_LIMITED',
    retryAfterSeconds: 900,
  });
  now = 899999;
  assert.throws(() => middleware({}, response(userId), next), {
    retryAfterSeconds: 1,
  });
  for (let i = 0; i < 9999; i++) middleware({}, response(randomUUID()), next);
  assert.throws(() => middleware({}, response(randomUUID()), next), {
    code: 'RATE_LIMITED',
    retryAfterSeconds: 60,
  });
  now = 900000;
  middleware({}, response(userId), next);
  now = 1800000;
  middleware({}, response(randomUUID()), next);
  assert.equal(allowed, 10061);
});

test('every marketplace endpoint authenticates before validation, parsing or mutation limits', async (t) => {
  const f = await http(t);
  for (const [method, path] of [
    ['GET', '/categories'],
    ['GET', '/places'],
    ['GET', '/places/bad'],
    ['GET', '/posts'],
    ['PUT', '/places/bad/favorite'],
    ['DELETE', '/places/bad/favorite'],
    ['PUT', '/places/bad/rating'],
    ['DELETE', '/places/bad/rating'],
  ]) {
    for (const authorization of [
      '',
      'Bearer broken',
      `Bearer ${'B'.repeat(43)}`,
    ]) {
      const response = await f.request(path, {
        method,
        headers: { Authorization: authorization },
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
  }
});

test('HTTP strictly validates queries, parameters, JSON content, parser errors and safe envelopes', async (t) => {
  const f = await http(t);
  for (const path of [
    '/categories?userId=x',
    '/places?search=%20',
    '/places?limit=1&limit=2',
    '/places?search[]=x',
    '/posts?type=bad',
    '/posts?placeId=bad',
    '/places/bad',
    `/places/${placeId}?userId=x`,
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  for (const [body, headers, status, code] of [
    [
      '{"rating":4}',
      { 'Content-Type': 'text/plain' },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      '{"rating":4}',
      { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      '{"rating":4}',
      { 'Content-Type': 'application/json; charset=iso-8859-1' },
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    ['{', { 'Content-Type': 'application/json' }, 400, 'INVALID_JSON'],
    ['4', { 'Content-Type': 'application/json' }, 400, 'INVALID_JSON'],
    [
      '{"rating":4,"userId":"spoof"}',
      { 'Content-Type': 'application/json' },
      400,
      'VALIDATION_ERROR',
    ],
    [
      '{"rating":0}',
      { 'Content-Type': 'application/json' },
      400,
      'VALIDATION_ERROR',
    ],
    [
      '{"rating":6}',
      { 'Content-Type': 'application/json' },
      400,
      'VALIDATION_ERROR',
    ],
    [
      'x'.repeat(9000),
      { 'Content-Type': 'application/json' },
      413,
      'REQUEST_TOO_LARGE',
    ],
    [undefined, {}, 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ]) {
    const response = await f.request(`/places/${placeId}/rating`, {
      method: 'PUT',
      body,
      headers,
    });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.error.code, code);
    assert.deepEqual(Object.keys(result), ['error']);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
  }
  assert.equal(
    (
      await f.request(`/places/${placeId}/favorite`, {
        method: 'PUT',
        body: '{}',
      })
    ).status,
    400,
  );
  for (const value of [1, 5]) {
    const response = await f.request(`/places/${placeId}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: value }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.myRating, value);
  }
  assert.equal(
    (await f.request(`/places/${placeId}/rating`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal((await f.request(`/places/${randomUUID()}`)).status, 404);
});

test('HTTP mutation limit is shared across mutations, keyed by session user, and excludes reads', async (t) => {
  const f = await http(t);
  for (let i = 0; i < 60; i++) {
    const method = i % 2 ? 'DELETE' : 'PUT';
    assert.equal(
      (await f.request(`/places/${placeId}/favorite`, { method })).status,
      200,
    );
  }
  const response = await f.request(`/places/${placeId}/rating`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 429);
  assert.ok(
    Number(response.headers.get('retry-after')) >= 1 &&
      Number(response.headers.get('retry-after')) <= 900,
  );
  assert.equal((await response.json()).error.code, 'RATE_LIMITED');
  for (const path of ['/categories', '/places', '/posts', `/places/${placeId}`])
    assert.equal((await f.request(path)).status, 200);
  assert.equal(f.authentications(), 65);
});

test('unexpected feature failures retain the safe global internal error response', async (t) => {
  const f = await http(t, {
    categories: () => {
      throw new Error('private SQL credentials');
    },
  });
  const response = await f.request('/categories');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
});

test('repository explicitly converts numeric strings and UTC timestamps without leaking persistence fields', async () => {
  const row = {
    id: placeId,
    name: 'Fictional',
    slug: 'fictional',
    description: 'Full text',
    address: 'Test lane',
    coverImageUrl: null,
    categoryId: randomUUID(),
    categoryName: 'Goods',
    categorySlug: 'goods',
    iconKey: 'shop',
    averageRating: '3.6666666666666667',
    ratingCount: '3',
    myRating: 4,
    isFavorite: true,
    total: '1',
    created_at: new Date(),
  };
  const repository = new MarketplaceRepository({
    query: async () => ({ rows: [row] }),
  });
  const result = await repository.places(userId, { page: 1, limit: 20 });
  assert.equal(result.items[0].averageRating, 3.7);
  assert.equal(result.items[0].ratingCount, 3);
  assert.equal(result.totalItems, 1);
  assert.equal('created_at' in result.items[0], false);
  const posts = new MarketplaceRepository({
    query: async () => ({
      rows: [
        {
          id: randomUUID(),
          type: 'news',
          title: 'Title',
          body: 'Body',
          imageUrl: null,
          startsAt: new Date('2026-01-01T02:00:00+02:00'),
          endsAt: null,
          isFavoritePlace: false,
          placeId,
          placeName: row.name,
          placeSlug: row.slug,
          coverImageUrl: null,
          total: '1',
        },
      ],
    }),
  });
  assert.equal(
    (await posts.posts(userId, { page: 1, limit: 20 }, new Date())).items[0]
      .startsAt,
    '2026-01-01T00:00:00.000Z',
  );
});

test('repository rolls back and releases failed transactions without swallowing failures', async () => {
  const calls = [];
  const failure = new Error('private query failure');
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT p.id')) throw failure;
      return { rows: [] };
    },
    release(discard) {
      calls.push(discard);
    },
  };
  const repo = new MarketplaceRepository({ connect: async () => client });
  await assert.rejects(
    repo.favorite(userId, placeId, true),
    (error) => error === failure,
  );
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls.at(-2), 'ROLLBACK');
  assert.equal(calls.at(-1), true);
});
