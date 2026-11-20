import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { IdentitySnapshot } from './profile.types.js';

export function usernameBase(first: string, last: string): string {
  const normalize = (v: string) =>
    v
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const a = normalize(first),
    b = normalize(last);
  const base = [a, b].filter(Boolean).join('.').slice(0, 24).replace(/\.$/, '');
  if (/^[a-z][a-z0-9.]{2,23}$/.test(base)) return base;
  // Hash names only, never the SIS id, email or another private identifier.
  return `member.${createHash('sha256')
    .update(`${first.normalize('NFKC')}\0${last.normalize('NFKC')}`)
    .digest('hex')
    .slice(0, 12)}`;
}

// Shared by OTP creation and hydration, always inside the caller's transaction.
export async function persistIdentity(
  client: PoolClient,
  userId: string,
  identity: IdentitySnapshot,
) {
  const base = usernameBase(identity.firstName, identity.lastName);
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 18022028))',
    [base],
  );
  const values = [
    userId,
    identity.firstName,
    identity.lastName,
    identity.roles,
    JSON.stringify(identity.academic),
  ];
  // Existing usernames and user-editable fields remain stable on institutional refresh.
  const updated = await client.query(
    `UPDATE public.user_profile SET first_name=$2, last_name=$3, roles=$4, academic=$5, identity_synced_at=CURRENT_TIMESTAMP WHERE user_id=$1`,
    values,
  );
  if (updated.rowCount) return;
  for (let suffix = 1; suffix <= 999999; suffix++) {
    const username = `${base}${suffix === 1 ? '' : suffix}`;
    const inserted = await client.query(
      `INSERT INTO public.user_profile (user_id,first_name,last_name,roles,academic,username) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING user_id`,
      [...values, username],
    );
    if (inserted.rowCount) return;
    const existing = await client.query(
      'SELECT 1 FROM public.user_profile WHERE user_id=$1',
      [userId],
    );
    if (existing.rowCount) return;
  }
  throw new Error('Username allocation capacity exceeded.');
}
