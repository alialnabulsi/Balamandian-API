import express, { type ErrorRequestHandler } from 'express';

import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AuthService } from './modules/auth/auth.service.js';
import { HttpError } from './shared/http-error.js';

const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    if (error.retryAfterSeconds)
      response.set('Retry-After', String(error.retryAfterSeconds));
    if (error.status === 401) response.set('WWW-Authenticate', 'Bearer');
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (typeof error === 'object' && error !== null && 'type' in error) {
    const failures: Record<
      string,
      { status: number; code: string; message: string }
    > = {
      'entity.too.large': {
        status: 413,
        code: 'REQUEST_TOO_LARGE',
        message: 'Request body is too large.',
      },
      'entity.parse.failed': {
        status: 400,
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
      },
      'encoding.unsupported': {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Compressed request bodies are not supported.',
      },
      'charset.unsupported': {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Use UTF-8 JSON.',
      },
      'request.aborted': {
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Request body was incomplete.',
      },
      'request.size.invalid': {
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Request body was incomplete.',
      },
    };
    const failure =
      typeof error.type === 'string' ? failures[error.type] : undefined;
    if (failure) {
      response
        .status(failure.status)
        .json({ error: { code: failure.code, message: failure.message } });
      return;
    }
  }

  console.error('Unhandled HTTP request error.');

  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
};

export function createApp(authService: AuthService) {
  const app = express();

  app.disable('x-powered-by');
  app.disable('etag');
  app.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', createAuthRouter(authService));

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });

  app.use(errorHandler);

  return app;
}
