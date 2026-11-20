import type { Pool } from 'pg';
import type { SisGateway } from '../auth/auth.types.js';
import { ProfileRepository } from './profile.repository.js';
import { ProfileService } from './profile.service.js';
export function createProfileDependencies(pool: Pool, sis: SisGateway) {
  return { service: new ProfileService(new ProfileRepository(pool), sis) };
}
