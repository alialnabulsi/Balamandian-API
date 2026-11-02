import type { ReadableStream } from 'node:stream/web';

import { HttpError } from '../../shared/http-error.js';
import type {
  Credentials,
  SisGateway,
  SisIdentity,
} from '../../modules/auth/auth.types.js';
import { validInstitutionalEmail } from '../../modules/auth/auth.validators.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

function malformed() {
  return new HttpError(
    502,
    'SIS_INVALID_RESPONSE',
    'The institutional service returned an invalid response.',
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SisAdapter implements SisGateway {
  constructor(
    private readonly config: {
      sisBaseUrl: string;
      sisServiceKey: string;
      sisTimeoutMs: number;
    },
    private readonly fetchRequest: typeof fetch = fetch,
  ) {}

  async verify(credentials: Credentials): Promise<SisIdentity> {
    // Timeout includes response headers and bounded body consumption. Never retry credentials.
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.sisTimeoutMs,
    );
    timeout.unref();
    let response: Response | undefined;
    try {
      response = await this.fetchRequest(
        new URL('/api/v1/auth/verify', this.config.sisBaseUrl),
        {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.sisServiceKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(credentials),
        },
      );
      if (response.status === 429) {
        throw new HttpError(
          429,
          'SIS_RATE_LIMITED',
          'The institutional service is rate limiting requests. Try again later.',
          60,
        );
      }
      if (response.status >= 500 || response.status === 403) {
        // A forbidden service key is an integration failure, never a user's account state.
        throw new HttpError(
          503,
          'SIS_UNAVAILABLE',
          'The institutional service is temporarily unavailable.',
        );
      }
      if (
        ![200, 400, 401].includes(response.status) ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? '',
        ) ||
        !response.body
      )
        throw malformed();
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw malformed();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw malformed();
      }
      if (response.status === 401 && record(payload) && record(payload.error)) {
        if (payload.error.code === 'INVALID_CREDENTIALS') {
          throw new HttpError(
            401,
            'SIS_INVALID_CREDENTIALS',
            'The institutional credentials are invalid.',
          );
        }
        if (payload.error.code === 'SERVICE_UNAUTHORIZED') {
          throw new HttpError(
            503,
            'SIS_UNAVAILABLE',
            'The institutional service is temporarily unavailable.',
          );
        }
      }
      if (
        response.status === 400 &&
        record(payload) &&
        record(payload.error) &&
        payload.error.code === 'VALIDATION_ERROR'
      ) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Invalid institutional credential fields.',
        );
      }
      if (response.status !== 200) throw malformed();
      if (!record(payload) || !record(payload.data)) throw malformed();
      const { userId, email } = payload.data;
      if (
        typeof userId !== 'string' ||
        !userId ||
        userId.length > 128 ||
        /[\s\p{Cc}]/u.test(userId) ||
        !validInstitutionalEmail(email)
      )
        throw malformed();
      // SIS academic records and roles are intentionally neither persisted nor application permissions.
      return { userId, email };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        'SIS_UNAVAILABLE',
        'The institutional service is temporarily unavailable.',
      );
    } finally {
      clearTimeout(timeout);
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => undefined);
      }
    }
  }
}
