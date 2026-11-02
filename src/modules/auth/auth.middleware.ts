import { createHash } from 'node:crypto';

import type { RequestHandler } from 'express';

import { HttpError } from '../../shared/http-error.js';
import type { AuthService } from './auth.service.js';
import type { AuthenticatedSession } from './auth.types.js';

export function sessionAuthentication(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match?.[1])
      throw new HttpError(
        401,
        'UNAUTHENTICATED',
        'A valid application session is required.',
      );
    response.locals.auth = await service.authenticate(match[1]);
    next();
  };
}

export function authenticatedSession(locals: Record<string, unknown>) {
  // Only called after sessionAuthentication has successfully populated locals.
  return locals.auth as AuthenticatedSession;
}

export class AuthRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  middleware(
    scope: string,
    limit: number,
    windowMs: number,
    byIdentifier = false,
  ): RequestHandler {
    return (request, _response, next) => {
      const now = this.now();
      // Bounded memory even if clients send many distinct identifiers/IP addresses.
      if (this.buckets.size >= 10_000) {
        for (const [key, bucket] of this.buckets) {
          if (bucket.expiresAt <= now) this.buckets.delete(key);
        }
      }
      let subject = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      if (byIdentifier) {
        const body: unknown = request.body;
        if (
          typeof body !== 'object' ||
          !body ||
          !('identifier' in body) ||
          typeof body.identifier !== 'string'
        )
          return next();
        subject = createHash('sha256')
          .update(body.identifier.trim().toLowerCase())
          .digest('hex');
      }
      const key = `${scope}:${subject}`;
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.expiresAt <= now) {
        if (!bucket && this.buckets.size >= 10_000) {
          throw new HttpError(
            429,
            'RATE_LIMITED',
            'Too many authentication requests. Try again later.',
            60,
          );
        }
        bucket = { count: 0, expiresAt: now + windowMs };
        this.buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Too many authentication requests. Try again later.',
          Math.ceil((bucket.expiresAt - now) / 1000),
        );
      }
      bucket.count += 1;
      next();
    };
  }
}
