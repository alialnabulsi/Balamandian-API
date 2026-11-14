import type { Pool } from 'pg';

import { MarketplaceRepository } from './marketplace.repository.js';
import { MarketplaceService } from './marketplace.service.js';

export function createMarketplaceDependencies(pool: Pool) {
  return { service: new MarketplaceService(new MarketplaceRepository(pool)) };
}
