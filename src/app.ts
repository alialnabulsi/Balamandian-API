import express, { type ErrorRequestHandler } from 'express';

const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  console.error('Unhandled HTTP request error.');

  if (response.headersSent) {
    next(error);
    return;
  }

  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
};

export function createApp() {
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

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });

  app.use(errorHandler);

  return app;
}
