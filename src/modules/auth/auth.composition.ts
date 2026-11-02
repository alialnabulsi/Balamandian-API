import type { Pool } from 'pg';

import type { AuthConfig } from '../../config/auth.js';
import { SmtpMailer } from '../../integrations/email/smtp.adapter.js';
import { SisAdapter } from '../../integrations/sis/sis.adapter.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

export function createAuthDependencies(pool: Pool, config: AuthConfig) {
  const mailer = new SmtpMailer(config);
  const service = new AuthService(
    new AuthRepository(pool),
    new SisAdapter(config),
    mailer,
    config,
  );
  return { service, close: () => mailer.close() };
}
