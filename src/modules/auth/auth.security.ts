import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const OTP_POLICY = Object.freeze({
  lifetimeMs: 10 * 60_000,
  attempts: 5,
  cooldownMs: 60_000,
  resends: 3,
  registrationLifetimeMs: 60 * 60_000,
});

export function generateOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpVerifier(
  secret: string,
  registrationId: string,
  otp: string,
) {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`registration-otp:${registrationId}:${otp}`)
    .digest('hex');
}

export function matchesOtp(expected: string, candidate: string) {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(candidate, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
