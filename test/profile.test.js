import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import sharp from 'sharp';
import { parseSisIdentity } from '../dist/integrations/sis/sis.identity.js';
import { usernameBase } from '../dist/modules/profile/profile.identity.js';
import {
  biography,
  members,
} from '../dist/modules/profile/profile.validators.js';
import { normalizeAvatar } from '../dist/modules/profile/profile.avatar.js';

test('SIS identity selects bounded multi-role academic data without copying private records', () => {
  const department = { name: 'Computing', faculty: { name: 'Science' } };
  const identity = parseSisIdentity({
    userId: 'FICTION',
    email: 'member@example.edu',
    firstName: ' Ali ',
    lastName: 'Al Nabulsi',
    roles: ['student', 'advisor', 'instructor'],
    student: {
      admissionYear: 2023,
      primaryCampus: { name: 'Main' },
      programs: [
        { name: 'Computing', department },
        { name: 'Mathematics', department },
      ],
    },
    instructor: { department },
    advisor: { department },
    grades: ['private'],
  });
  assert.equal(identity.firstName, 'Ali');
  assert.equal(identity.roles.length, 3);
  assert.equal(identity.academic.programs.length, 2);
  assert.equal(identity.academic.departments.length, 1);
  assert.equal('grades' in identity, false);
  for (const change of [
    { firstName: '' },
    { roles: [] },
    { roles: ['invented role'] },
    { student: { programs: Array(17).fill({}) } },
    { lastName: 123 },
  ])
    assert.throws(() =>
      parseSisIdentity({ ...identity, student: null, ...change }),
    );
});
test('usernames normalize accents, punctuation and compound names, with deterministic non-Latin fallback', () => {
  assert.equal(usernameBase('Ali', 'Al Nabulsi'), 'ali.alnabulsi');
  assert.equal(usernameBase('Jöhn', 'O’Smith'), 'john.osmith');
  assert.match(usernameBase('علي', 'أحمد'), /^member\.[a-f0-9]{12}$/);
  assert.equal(usernameBase('علي', 'أحمد'), usernameBase('علي', 'أحمد'));
  assert.ok(usernameBase('a'.repeat(100), 'b'.repeat(100)).length <= 24);
});
test('biography rejects every official field, uses 250 Unicode code points, and pagination is bounded', () => {
  assert.equal(members({ search: '@john.smith' }).search, 'john.smith');
  assert.equal(biography({ biography: ' hello ' }), 'hello');
  assert.equal(biography({ biography: '😀'.repeat(250) }).length, 500);
  for (const v of [
    { biography: 'a'.repeat(251) },
    { biography: 'ok', username: 'fake' },
    { roles: [] },
    { biography: 'bad\0' },
    [],
  ])
    assert.throws(() => biography(v));
  for (const v of [
    { page: '0' },
    { limit: '51' },
    { search: ['a'] },
    { unknown: 'x' },
  ])
    assert.throws(() => members(v));
});
test('avatars are decoded, bounded and stripped to WebP; malformed/SVG/animation/oversized dimensions fail', async () => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const result = await normalizeAvatar(png);
  assert.equal((await sharp(result).metadata()).format, 'webp');
  for (const bytes of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
    ),
    Buffer.from('bad'),
    Buffer.alloc(1000001),
    await sharp({
      create: { width: 4097, height: 1, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer(),
  ])
    await assert.rejects(normalizeAvatar(bytes), { code: 'AVATAR_INVALID' });
});
