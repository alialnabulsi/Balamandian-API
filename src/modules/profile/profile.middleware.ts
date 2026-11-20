import type { RequestHandler } from 'express';
import { HttpError } from '../../shared/http-error.js';
import { authenticatedSession } from '../auth/auth.middleware.js';

export class ProfileRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; expires: number }
  >();
  constructor(
    private readonly maximum = 60,
    private readonly windowMs = 900000,
  ) {}
  middleware(): RequestHandler {
    return (_req, res, next) => {
      const now = Date.now(),
        key = authenticatedSession(res.locals).user.id;
      if (this.buckets.size >= 10000)
        for (const [k, v] of this.buckets)
          if (v.expires <= now) this.buckets.delete(k);
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.expires <= now) {
        if (!bucket && this.buckets.size >= 10000)
          throw new HttpError(429, 'RATE_LIMITED', 'Please retry shortly.', 60);
        bucket = { count: 0, expires: now + this.windowMs };
        this.buckets.set(key, bucket);
      }
      if (bucket.count++ >= this.maximum)
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Too many profile requests. Try again later.',
          Math.max(1, Math.ceil((bucket.expires - now) / 1000)),
        );
      next();
    };
  }
}
export const noBody: RequestHandler = (req, _res, next) => {
  if (
    req.headers['transfer-encoding'] ||
    (req.headers['content-length'] && req.headers['content-length'] !== '0')
  )
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'This request does not accept a body.',
    );
  next();
};
export const avatarType: RequestHandler = (req, _res, next) => {
  if (
    !req.is(['image/jpeg', 'image/png', 'image/webp']) ||
    (req.headers['content-encoding'] &&
      req.headers['content-encoding'] !== 'identity')
  )
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Use uncompressed JPG, PNG or WebP.',
    );
  next();
};
export const jsonType: RequestHandler = (req, _res, next) => {
  if (!req.is('application/json'))
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  next();
};
