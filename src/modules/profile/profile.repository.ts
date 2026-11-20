import type { Pool, PoolClient } from 'pg';
import { HttpError } from '../../shared/http-error.js';
import { persistIdentity } from './profile.identity.js';
import type {
  IdentitySnapshot,
  AcademicIdentity,
  MemberQuery,
  PublicProfile,
  OwnProfile,
  MemberPage,
} from './profile.types.js';

interface ProfileRow {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  biography: string;
  roles: string[];
  version: string | null;
  followers: string;
  following: string;
  is_following: boolean;
}
const publicColumns = `u.id, p.username, p.first_name, p.last_name, p.biography, p.roles,
  a.version,
  (SELECT count(*) FROM public.user_follow f JOIN public.app_user m ON m.id=f.follower_id AND m.status='active' WHERE f.following_id=u.id) AS followers,
  (SELECT count(*) FROM public.user_follow f JOIN public.app_user m ON m.id=f.following_id AND m.status='active' WHERE f.follower_id=u.id) AS following,
  EXISTS(SELECT 1 FROM public.user_follow f WHERE f.follower_id=$2 AND f.following_id=u.id) AS is_following`;
const profileFrom = `FROM public.app_user u JOIN public.user_profile p ON p.user_id=u.id LEFT JOIN public.user_avatar a ON a.user_id=u.id`;
const available = `u.status='active' AND u.email_verified_at IS NOT NULL`;

function publicDto(row: ProfileRow, viewer: string): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: `${row.first_name} ${row.last_name}`,
    biography: row.biography,
    avatarPath: row.version
      ? `/api/v1/users/${row.id}/avatar?v=${row.version}`
      : null,
    verified: true,
    roles: row.roles.filter((r) =>
      ['student', 'instructor', 'advisor', 'staff'].includes(r),
    ),
    postsCount: 0,
    followersCount: Number(row.followers),
    followingCount: Number(row.following),
    isFollowing: row.is_following,
    isSelf: row.id === viewer,
  };
}
export function unavailable(): never {
  throw new HttpError(
    404,
    'PROFILE_NOT_FOUND',
    'This university profile is unavailable.',
  );
}

export class ProfileRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      committed = true;
      return result;
    } finally {
      try {
        if (!committed) await client.query('ROLLBACK');
      } finally {
        client.release(!committed);
      }
    }
  }
  async hydrate(id: string, identity: IdentitySnapshot) {
    return this.transaction(async (client) => {
      const user = await client.query(
        `SELECT id FROM public.app_user WHERE id=$1 AND status='active' FOR UPDATE`,
        [id],
      );
      if (!user.rowCount) unavailable();
      const existing = await client.query(
        'SELECT 1 FROM public.user_profile WHERE user_id=$1',
        [id],
      );
      if (!existing.rowCount) await persistIdentity(client, id, identity);
    });
  }
  async profile(
    id: string,
    viewer: string,
  ): Promise<PublicProfile | undefined> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT ${publicColumns} ${profileFrom} WHERE u.id=$1 AND ${available}`,
      [id, viewer],
    );
    return result.rows[0] ? publicDto(result.rows[0], viewer) : undefined;
  }
  async own(id: string): Promise<OwnProfile | undefined> {
    const result = await this.pool.query<
      ProfileRow & {
        sis_user_id: string;
        institutional_email: string;
        created_at: Date;
        email_verified_at: Date;
        academic: AcademicIdentity;
      }
    >(
      `SELECT ${publicColumns}, u.sis_user_id, u.institutional_email, u.created_at, u.email_verified_at, p.academic ${profileFrom} WHERE u.id=$1 AND ${available}`,
      [id, id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      ...publicDto(row, id),
      account: {
        firstName: row.first_name,
        lastName: row.last_name,
        sisId: row.sis_user_id,
        institutionalEmail: row.institutional_email,
        createdAt: row.created_at.toISOString(),
        emailVerifiedAt: row.email_verified_at.toISOString(),
        institutionalRoles: row.roles,
        academic: row.academic,
      },
    };
  }
  async biography(id: string, value: string) {
    const result = await this.pool.query(
      'UPDATE public.user_profile SET biography=$2 WHERE user_id=$1',
      [id, value],
    );
    if (!result.rowCount) unavailable();
  }
  async avatar(id: string): Promise<Buffer | undefined> {
    const result = await this.pool.query<{ content: Buffer }>(
      `SELECT a.content FROM public.user_avatar a JOIN public.app_user u ON u.id=a.user_id WHERE a.user_id=$1 AND ${available}`,
      [id],
    );
    return result.rows[0]?.content;
  }
  async setAvatar(id: string, bytes: Buffer | null) {
    if (bytes)
      await this.pool.query(
        `INSERT INTO public.user_avatar(user_id,content) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET content=EXCLUDED.content, version=gen_random_uuid(), updated_at=CURRENT_TIMESTAMP`,
        [id, bytes],
      );
    else
      await this.pool.query('DELETE FROM public.user_avatar WHERE user_id=$1', [
        id,
      ]);
  }
  async follow(viewer: string, target: string, following: boolean) {
    return this.transaction(async (client) => {
      // Both endpoints lock participants in UUID order; opposite-direction mutations cannot deadlock.
      const users = await client.query<{ id: string }>(
        `SELECT u.id FROM public.app_user u JOIN public.user_profile p ON p.user_id=u.id WHERE u.id=ANY($1::uuid[]) AND ${available} ORDER BY u.id FOR UPDATE OF u`,
        [[viewer, target]],
      );
      if (users.rowCount !== 2) unavailable();
      if (following)
        await client.query(
          `INSERT INTO public.user_follow(follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [viewer, target],
        );
      else
        await client.query(
          'DELETE FROM public.user_follow WHERE follower_id=$1 AND following_id=$2',
          [viewer, target],
        );
      const rows = await client.query<ProfileRow>(
        `SELECT ${publicColumns} ${profileFrom} WHERE u.id=$1`,
        [target, viewer],
      );
      return publicDto(rows.rows[0]!, viewer);
    });
  }
  async members(
    viewer: string,
    query: MemberQuery,
    target?: string,
    direction?: 'followers' | 'following',
  ): Promise<MemberPage> {
    if (target && !(await this.profile(target, viewer))) unavailable();
    // One statement snapshot for count and page, including out-of-range pages. No per-row requests.
    const filter = target
      ? direction === 'followers'
        ? 'AND EXISTS(SELECT 1 FROM public.user_follow f WHERE f.following_id=$5 AND f.follower_id=u.id)'
        : 'AND EXISTS(SELECT 1 FROM public.user_follow f WHERE f.follower_id=$5 AND f.following_id=u.id)'
      : 'AND u.id<>$2';
    const result = await this.pool.query<{
      total: string;
      items: ProfileRow[];
    }>(
      `WITH members AS (
      SELECT ${publicColumns} ${profileFrom} WHERE ${available}
      AND ($1='' OR strpos(lower(p.username),lower($1))>0 OR strpos(lower(p.first_name || ' ' || p.last_name),lower($1))>0) ${filter}
    ), page AS (SELECT * FROM members ORDER BY username,id LIMIT $3 OFFSET $4)
    SELECT (SELECT count(*) FROM members) AS total, COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY username,id) FROM page),'[]'::jsonb) AS items`,
      target
        ? [
            query.search,
            viewer,
            query.limit,
            (query.page - 1) * query.limit,
            target,
          ]
        : [query.search, viewer, query.limit, (query.page - 1) * query.limit],
    );
    const row = result.rows[0]!;
    const total = Number(row.total);
    return {
      items: row.items.map((r) => publicDto(r, viewer)),
      page: query.page,
      limit: query.limit,
      total,
      hasMore: query.page * query.limit < total,
    };
  }
}
