import { json, Router } from 'express';

import { HttpError } from '../../shared/http-error.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimiter, sessionAuthentication } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';

export function createAuthRouter(
  service: AuthService,
  limiter = new AuthRateLimiter(),
) {
  const router = Router();
  const controller = new AuthController(service);
  const authenticated = sessionAuthentication(service);
  const credentialIpLimit = limiter.middleware(
    'credentials-ip',
    20,
    15 * 60_000,
  );
  const credentialIdentityLimit = limiter.middleware(
    'credentials-identifier',
    10,
    15 * 60_000,
    true,
  );
  const otpLimit = limiter.middleware('otp-ip', 60, 15 * 60_000);

  router.use(limiter.middleware('auth-ip', 120, 60_000));
  router.use(json({ limit: '8kb', strict: true, inflate: false }));
  router.use((request, _response, next) => {
    if (
      request.method === 'POST' &&
      request.path !== '/logout' &&
      !request.is('application/json')
    ) {
      throw new HttpError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Use application/json.',
      );
    }
    next();
  });
  router.post(
    '/register',
    credentialIpLimit,
    credentialIdentityLimit,
    controller.register,
  );
  router.post('/register/verify', otpLimit, controller.verify);
  router.post('/register/resend', otpLimit, controller.resend);
  router.post(
    '/login',
    credentialIpLimit,
    credentialIdentityLimit,
    controller.login,
  );
  router.get('/me', authenticated, controller.me);
  router.post('/logout', authenticated, controller.logout);
  return router;
}
