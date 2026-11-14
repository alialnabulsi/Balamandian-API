import type { RequestHandler } from 'express';

import { HttpError } from '../../shared/http-error.js';
import { authenticatedSession } from '../auth/auth.middleware.js';

export class MarketplaceRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  middleware(): RequestHandler {
    return (_request, response, next) => {
      const now = this.now();
      if (this.buckets.size >= 10_000) {
        for (const [key, bucket] of this.buckets) {
          if (bucket.expiresAt <= now) this.buckets.delete(key);
        }
      }
      const key = authenticatedSession(response.locals).user.id;
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.expiresAt <= now) {
        if (!bucket && this.buckets.size >= 10_000) this.limited(60);
        bucket = { count: 0, expiresAt: now + 15 * 60_000 };
        this.buckets.set(key, bucket);
      }
      if (bucket.count >= 60)
        this.limited(Math.ceil((bucket.expiresAt - now) / 1000));
      bucket.count++;
      next();
    };
  }

  private limited(seconds: number): never {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Too many marketplace changes. Try again later.',
      Math.max(1, Math.min(900, seconds)),
    );
  }
}

export const ratingContentType: RequestHandler = (request, _response, next) => {
  if (
    !request.is('application/json') ||
    (request.headers['content-encoding'] !== undefined &&
      request.headers['content-encoding'].toLowerCase() !== 'identity')
  ) {
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Use uncompressed application/json.',
    );
  }
  next();
};

export const noBody: RequestHandler = (request, _response, next) => {
  if (
    request.headers['transfer-encoding'] !== undefined ||
    (request.headers['content-length'] !== undefined &&
      request.headers['content-length'] !== '0')
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'This marketplace request does not accept a body.',
    );
  }
  next();
};
