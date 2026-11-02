import type { Pool, PoolClient } from 'pg';

import type {
  AppUser,
  AuthenticatedSession,
  NewSession,
  PendingRegistration,
  SisIdentity,
} from './auth.types.js';

const userColumns = `id, sis_user_id AS "sisUserId",
  institutional_email AS "institutionalEmail", email_verified_at AS "emailVerifiedAt", status`;
const pendingColumns = `id, sis_user_id AS "sisUserId", institutional_email AS "institutionalEmail",
  otp_verifier AS "otpVerifier", otp_expires_at AS "otpExpiresAt",
  failed_attempts AS "failedAttempts", resend_count AS "resendCount",
  next_send_at AS "nextSendAt", registration_expires_at AS "registrationExpiresAt",
  delivery_state AS "deliveryState", consumed_at AS "consumedAt",
  invalidated_at AS "invalidatedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export class AuthTransaction {
  constructor(private readonly client: PoolClient) {}

  async findUser(sisUserId: string) {
    const result = await this.client.query<AppUser>(
      `SELECT ${userColumns} FROM public.app_user WHERE sis_user_id = $1 FOR UPDATE`,
      [sisUserId],
    );
    return result.rows[0];
  }

  async findPending(sisUserId: string) {
    const result = await this.client.query<PendingRegistration>(
      `SELECT ${pendingColumns} FROM public.pending_registration
       WHERE sis_user_id = $1 FOR UPDATE`,
      [sisUserId],
    );
    return result.rows[0];
  }

  async savePending(pending: PendingRegistration) {
    await this.client.query(
      `INSERT INTO public.pending_registration
       (id, sis_user_id, institutional_email, otp_verifier, otp_expires_at,
        failed_attempts, resend_count, next_send_at, registration_expires_at,
        delivery_state, consumed_at, invalidated_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (sis_user_id) DO UPDATE SET
         id = EXCLUDED.id, institutional_email = EXCLUDED.institutional_email,
         otp_verifier = EXCLUDED.otp_verifier, otp_expires_at = EXCLUDED.otp_expires_at,
         failed_attempts = EXCLUDED.failed_attempts, resend_count = EXCLUDED.resend_count,
         next_send_at = EXCLUDED.next_send_at, registration_expires_at = EXCLUDED.registration_expires_at,
         delivery_state = EXCLUDED.delivery_state, consumed_at = EXCLUDED.consumed_at,
         invalidated_at = EXCLUDED.invalidated_at, created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        pending.id,
        pending.sisUserId,
        pending.institutionalEmail,
        pending.otpVerifier,
        pending.otpExpiresAt,
        pending.failedAttempts,
        pending.resendCount,
        pending.nextSendAt,
        pending.registrationExpiresAt,
        pending.deliveryState,
        pending.consumedAt,
        pending.invalidatedAt,
        pending.createdAt,
        pending.updatedAt,
      ],
    );
  }

  async createUser(identity: SisIdentity, now: Date) {
    const result = await this.client.query<AppUser>(
      `INSERT INTO public.app_user
       (sis_user_id, institutional_email, email_verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$3) RETURNING ${userColumns}`,
      [identity.userId, identity.email, now],
    );
    const user = result.rows[0];
    if (!user) throw new Error('User insert returned no identity.');
    return user;
  }

  async createSession(userId: string, session: NewSession) {
    await this.client.query(
      `INSERT INTO public.app_session (user_id, token_hash, created_at, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [userId, session.tokenHash, session.createdAt, session.expiresAt],
    );
  }
}

export class AuthRepository {
  constructor(private readonly pool: Pool) {}

  async withIdentity<T>(
    sisUserId: string,
    operation: (transaction: AuthTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // A shared lock order serializes register, resend, verify and login per SIS identity.
      // Hash collisions only serialize unrelated identities; they never merge accounts.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 18022027))',
        [sisUserId],
      );
      const result = await operation(new AuthTransaction(client));
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

  async findPending(id: string) {
    const result = await this.pool.query<PendingRegistration>(
      `SELECT ${pendingColumns} FROM public.pending_registration WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  async finishDelivery(
    pending: PendingRegistration,
    delivered: boolean,
    now: Date,
  ) {
    // A stale provider acceptance must never activate or invalidate a replacement code.
    const result = await this.pool.query(
      `UPDATE public.pending_registration SET delivery_state = $3, updated_at = $4
       WHERE id = $1 AND otp_verifier = $2 AND delivery_state = 'sending'
         AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [pending.id, pending.otpVerifier, delivered ? 'sent' : 'failed', now],
    );
    return result.rowCount === 1;
  }

  async findSession(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedSession | undefined> {
    const result = await this.pool.query<
      AppUser & { sessionId: string; expiresAt: Date }
    >(
      `SELECT u.id, u.sis_user_id AS "sisUserId", u.institutional_email AS "institutionalEmail",
        u.email_verified_at AS "emailVerifiedAt", u.status,
        s.id AS "sessionId", s.expires_at AS "expiresAt"
       FROM public.app_session s JOIN public.app_user u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
         AND u.status = 'active' AND u.email_verified_at IS NOT NULL`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const { sessionId, expiresAt, ...user } = row;
    return { sessionId, expiresAt, user };
  }

  async revokeSession(id: string, now: Date) {
    await this.pool.query(
      'UPDATE public.app_session SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL',
      [id, now],
    );
  }
}
