import type { Request, Response } from 'express';

import { authenticatedSession } from './auth.middleware.js';
import { publicUser, type AuthService } from './auth.service.js';
import * as validators from './auth.validators.js';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (request: Request, response: Response) => {
    const result = await this.service.register(
      validators.credentials(request.body),
    );
    response.status(202).json({ data: result });
  };

  verify = async (request: Request, response: Response) => {
    const { id, otp } = validators.verification(request.body);
    response.status(201).json({ data: await this.service.verify(id, otp) });
  };

  resend = async (request: Request, response: Response) => {
    response.status(202).json({
      data: await this.service.resend(validators.resend(request.body)),
    });
  };

  login = async (request: Request, response: Response) => {
    response.json({
      data: await this.service.login(validators.credentials(request.body)),
    });
  };

  me = (_request: Request, response: Response) => {
    const session = authenticatedSession(response.locals);
    response.json({
      data: {
        user: publicUser(session.user),
        session: { expiresAt: session.expiresAt.toISOString() },
      },
    });
  };

  logout = async (_request: Request, response: Response) => {
    await this.service.logout(authenticatedSession(response.locals).sessionId);
    response.status(204).end();
  };
}
