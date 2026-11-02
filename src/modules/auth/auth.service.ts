import { randomUUID } from 'node:crypto';

import { HttpError } from '../../shared/http-error.js';
import type { AuthRepository } from './auth.repository.js';
import {
  generateOtp,
  generateSessionToken,
  hashSessionToken,
  matchesOtp,
  otpVerifier,
  OTP_POLICY,
} from './auth.security.js';
import type {
  AppUser,
  Credentials,
  OtpMailer,
  PendingRegistration,
  SisGateway,
  SisIdentity,
} from './auth.types.js';

function invalidRegistration() {
  return new HttpError(
    400,
    'REGISTRATION_INVALID',
    'Registration is unavailable. Start registration again.',
  );
}

function accountExists() {
  return new HttpError(
    409,
    'ACCOUNT_EXISTS',
    'An application account already exists. Please log in.',
  );
}

export function publicUser(user: AppUser) {
  return {
    id: user.id,
    sisUserId: user.sisUserId,
    institutionalEmail: user.institutionalEmail,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

interface ServiceOptions {
  otpSecret: string;
  sessionLifetimeSeconds: number;
  now?: () => Date;
}

export class AuthService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: AuthRepository,
    private readonly sis: SisGateway,
    private readonly mailer: OtpMailer,
    private readonly options: ServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async register(credentials: Credentials) {
    const identity = await this.sis.verify(credentials);
    const reserved = await this.repository.withIdentity(
      identity.userId,
      async (tx) => {
        if (await tx.findUser(identity.userId)) throw accountExists();
        const previous = await tx.findPending(identity.userId);
        const now = this.now();
        const withinWindow = previous && previous.registrationExpiresAt > now;
        if (withinWindow) this.assertCanSend(previous, now);
        const pending = this.issueCode(
          identity,
          withinWindow ? previous : undefined,
          now,
          true,
        );
        await tx.savePending(pending.registration);
        return pending;
      },
    );
    return this.deliver(reserved);
  }

  async resend(id: string) {
    const existing = await this.repository.findPending(id);
    if (!existing) throw invalidRegistration();
    const reserved = await this.repository.withIdentity(
      existing.sisUserId,
      async (tx) => {
        const pending = await tx.findPending(existing.sisUserId);
        const now = this.now();
        if (
          !pending ||
          pending.id !== id ||
          pending.consumedAt ||
          pending.invalidatedAt ||
          pending.registrationExpiresAt <= now
        ) {
          throw invalidRegistration();
        }
        if (await tx.findUser(existing.sisUserId)) throw invalidRegistration();
        this.assertCanSend(pending, now);
        const issued = this.issueCode(
          { userId: pending.sisUserId, email: pending.institutionalEmail },
          pending,
          now,
          false,
        );
        await tx.savePending(issued.registration);
        return issued;
      },
    );
    return this.deliver(reserved);
  }

  async verify(id: string, otp: string) {
    const existing = await this.repository.findPending(id);
    if (!existing) throw invalidRegistration();
    const result = await this.repository.withIdentity(
      existing.sisUserId,
      async (tx) => {
        const pending = await tx.findPending(existing.sisUserId);
        const now = this.now();
        if (
          !pending ||
          pending.id !== id ||
          pending.consumedAt ||
          pending.invalidatedAt ||
          pending.registrationExpiresAt <= now
        ) {
          return invalidRegistration();
        }
        if (pending.deliveryState !== 'sent') {
          return new HttpError(
            409,
            'OTP_UNAVAILABLE',
            'The verification code is not available. Try resending it.',
          );
        }
        if (pending.otpExpiresAt <= now) {
          return new HttpError(
            410,
            'OTP_EXPIRED',
            'The verification code has expired. Request a new code.',
          );
        }
        if (pending.failedAttempts >= OTP_POLICY.attempts)
          return this.attemptLimit();
        const candidate = otpVerifier(this.options.otpSecret, id, otp);
        if (!matchesOtp(pending.otpVerifier, candidate)) {
          pending.failedAttempts += 1;
          pending.updatedAt = now;
          await tx.savePending(pending);
          // Return the error through COMMIT so incorrect attempts remain persistent.
          return pending.failedAttempts >= OTP_POLICY.attempts
            ? this.attemptLimit()
            : new HttpError(
                400,
                'OTP_INVALID',
                'The verification code is invalid.',
              );
        }
        if (await tx.findUser(pending.sisUserId)) return accountExists();
        const user = await tx.createUser(
          { userId: pending.sisUserId, email: pending.institutionalEmail },
          now,
        );
        const session = this.newSession(now);
        await tx.createSession(user.id, session.stored);
        pending.consumedAt = now;
        pending.updatedAt = now;
        await tx.savePending(pending);
        return this.authResponse(user, session);
      },
    );
    if (result instanceof HttpError) throw result;
    return result;
  }

  async login(credentials: Credentials) {
    // Every new login must verify with SIS, even if an application account exists.
    const identity = await this.sis.verify(credentials);
    return this.repository.withIdentity(identity.userId, async (tx) => {
      const user = await tx.findUser(identity.userId);
      if (!user)
        throw new HttpError(
          403,
          'REGISTRATION_REQUIRED',
          'Complete registration before logging in.',
        );
      if (!user.emailVerifiedAt)
        throw new HttpError(
          403,
          'EMAIL_NOT_VERIFIED',
          'Complete email verification before logging in.',
        );
      if (user.status !== 'active')
        throw new HttpError(
          403,
          'ACCOUNT_DISABLED',
          'This application account is disabled.',
        );
      // Identity is matched only by canonical SIS id. Email changes are never linked automatically.
      const session = this.newSession(this.now());
      await tx.createSession(user.id, session.stored);
      return this.authResponse(user, session);
    });
  }

  async authenticate(token: string) {
    const session = await this.repository.findSession(
      hashSessionToken(token),
      this.now(),
    );
    if (!session)
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'A valid application session is required.',
      );
    return session;
  }

  async logout(sessionId: string) {
    await this.repository.revokeSession(sessionId, this.now());
  }

  private assertCanSend(pending: PendingRegistration, now: Date) {
    if (pending.nextSendAt > now) {
      throw new HttpError(
        429,
        'OTP_COOLDOWN',
        'Please wait before requesting another code.',
        Math.ceil((pending.nextSendAt.getTime() - now.getTime()) / 1000),
      );
    }
    if (pending.resendCount >= OTP_POLICY.resends) {
      throw new HttpError(
        429,
        'OTP_RESEND_LIMIT',
        'The code delivery limit has been reached. Start registration again later.',
        Math.ceil(
          (pending.registrationExpiresAt.getTime() - now.getTime()) / 1000,
        ),
      );
    }
  }

  private issueCode(
    identity: SisIdentity,
    previous: PendingRegistration | undefined,
    now: Date,
    rotateId: boolean,
  ) {
    const id = !rotateId && previous ? previous.id : randomUUID();
    let otp: string;
    do {
      otp = generateOtp();
    } while (
      previous &&
      matchesOtp(
        previous.otpVerifier,
        otpVerifier(this.options.otpSecret, previous.id, otp),
      )
    );
    const registration: PendingRegistration = {
      id,
      sisUserId: identity.userId,
      institutionalEmail: identity.email,
      otpVerifier: otpVerifier(this.options.otpSecret, id, otp),
      otpExpiresAt: new Date(
        Math.min(
          now.getTime() + OTP_POLICY.lifetimeMs,
          previous?.registrationExpiresAt.getTime() ?? Infinity,
        ),
      ),
      failedAttempts: 0,
      resendCount: previous ? previous.resendCount + 1 : 0,
      nextSendAt: new Date(now.getTime() + OTP_POLICY.cooldownMs),
      registrationExpiresAt:
        previous?.registrationExpiresAt ??
        new Date(now.getTime() + OTP_POLICY.registrationLifetimeMs),
      deliveryState: 'sending',
      consumedAt: null,
      invalidatedAt: null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    return { registration, otp };
  }

  private async deliver(issued: {
    registration: PendingRegistration;
    otp: string;
  }) {
    const { registration, otp } = issued;
    // No database transaction is held during SMTP. Pending codes are unusable until accepted.
    try {
      await this.mailer.sendOtp(registration.institutionalEmail, otp);
    } catch {
      await this.repository.finishDelivery(registration, false, this.now());
      throw new HttpError(
        503,
        'EMAIL_UNAVAILABLE',
        'Verification email could not be delivered. Try registration again after the cooldown.',
      );
    }
    if (
      !(await this.repository.finishDelivery(registration, true, this.now()))
    ) {
      throw new HttpError(
        409,
        'REGISTRATION_REPLACED',
        'This registration was replaced. Use the latest registration.',
      );
    }
    return {
      pendingRegistrationId: registration.id,
      otpExpiresAt: registration.otpExpiresAt.toISOString(),
      resendAvailableAt: registration.nextSendAt.toISOString(),
    };
  }

  private attemptLimit() {
    return new HttpError(
      429,
      'OTP_ATTEMPT_LIMIT',
      'The verification attempt limit has been reached. Request a new code.',
    );
  }

  private newSession(now: Date) {
    const token = generateSessionToken();
    return {
      token,
      stored: {
        tokenHash: hashSessionToken(token),
        createdAt: now,
        expiresAt: new Date(
          now.getTime() + this.options.sessionLifetimeSeconds * 1000,
        ),
      },
    };
  }

  private authResponse(
    user: AppUser,
    session: ReturnType<AuthService['newSession']>,
  ) {
    return {
      user: publicUser(user),
      session: {
        token: session.token,
        tokenType: 'Bearer' as const,
        expiresAt: session.stored.expiresAt.toISOString(),
      },
    };
  }
}
