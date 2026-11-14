import { json, Router } from 'express';

import { sessionAuthentication } from '../auth/auth.middleware.js';
import type { AuthService } from '../auth/auth.service.js';
import { MarketplaceController } from './marketplace.controller.js';
import {
  MarketplaceRateLimiter,
  noBody,
  ratingContentType,
} from './marketplace.middleware.js';
import type { MarketplaceService } from './marketplace.service.js';

export function createMarketplaceRouter(
  service: MarketplaceService,
  authService: AuthService,
  limiter = new MarketplaceRateLimiter(),
) {
  const router = Router();
  const controller = new MarketplaceController(service);
  const mutation = limiter.middleware();
  router.use(sessionAuthentication(authService));
  router.get('/categories', controller.categories);
  router.get('/places', controller.places);
  router.get('/places/:placeId', controller.place);
  router.get('/posts', controller.posts);
  router.put(
    '/places/:placeId/favorite',
    mutation,
    noBody,
    controller.favorite(true),
  );
  router.delete(
    '/places/:placeId/favorite',
    mutation,
    noBody,
    controller.favorite(false),
  );
  router.put(
    '/places/:placeId/rating',
    mutation,
    ratingContentType,
    json({ limit: '8kb', strict: true, inflate: false }),
    controller.rating(false),
  );
  router.delete(
    '/places/:placeId/rating',
    mutation,
    noBody,
    controller.rating(true),
  );
  return router;
}
