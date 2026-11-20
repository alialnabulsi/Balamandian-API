import { json, raw, Router } from 'express';
import { sessionAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ProfileService } from './profile.service.js';
import { ProfileController } from './profile.controller.js';
import {
  ProfileRateLimiter,
  noBody,
  jsonType,
  avatarType,
} from './profile.middleware.js';

export function createProfileRouter(
  service: ProfileService,
  auth: AuthService,
) {
  const router = Router(),
    controller = new ProfileController(service);
  const mutation = new ProfileRateLimiter().middleware();
  router.use(
    sessionAuthentication(auth),
    new ProfileRateLimiter(300, 60000).middleware(),
  );
  router.get('/profile/me', controller.own);
  router.patch(
    '/profile/me',
    mutation,
    jsonType,
    json({ limit: '8kb', strict: true, inflate: false }),
    controller.update,
  );
  router.put(
    '/profile/me/avatar',
    mutation,
    avatarType,
    raw({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      limit: 1000000,
      inflate: false,
    }),
    controller.upload,
  );
  router.delete('/profile/me/avatar', mutation, noBody, controller.remove);
  router.get('/users', controller.members());
  router.get('/users/:userId/profile', controller.profile);
  router.get('/users/:userId/avatar', controller.avatar);
  router.get('/users/:userId/followers', controller.members('followers'));
  router.get('/users/:userId/following', controller.members('following'));
  router.put(
    '/users/:userId/follow',
    mutation,
    noBody,
    controller.follow(true),
  );
  router.delete(
    '/users/:userId/follow',
    mutation,
    noBody,
    controller.follow(false),
  );
  return router;
}
