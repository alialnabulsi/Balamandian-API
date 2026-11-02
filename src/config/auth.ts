import process from 'node:process';

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (!value || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number,
) {
  const value = environment[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return Number(value);
}

export function readAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const url = new URL(required(environment, 'SIS_BASE_URL'));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'SIS_BASE_URL must be an HTTPS origin without credentials.',
    );
  }
  const otpSecret = required(environment, 'OTP_SECRET');
  if (!/^[a-fA-F0-9]{64}$/.test(otpSecret)) {
    throw new Error('OTP_SECRET must contain 32 random bytes encoded as hex.');
  }
  const resendApiKey = required(environment, 'RESEND_API_KEY');
  if (/\s/u.test(resendApiKey)) {
    throw new Error('RESEND_API_KEY must not contain whitespace.');
  }
  const resendFromEmail = required(environment, 'RESEND_FROM_EMAIL');
  if (
    resendFromEmail.length > 254 ||
    !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(resendFromEmail)
  ) {
    throw new Error('RESEND_FROM_EMAIL must be a single email address.');
  }
  // The SDK's debug mode can print provider error bodies containing email data.
  if (environment.RESEND_DEBUG === 'true') {
    throw new Error(
      'RESEND_DEBUG must not be enabled for authentication email.',
    );
  }
  return {
    sisBaseUrl: url.origin,
    sisServiceKey: required(environment, 'SIS_SERVICE_API_KEY'),
    sisTimeoutMs: integer(environment, 'SIS_TIMEOUT_MS', 5000, 15_000),
    otpSecret,
    sessionLifetimeSeconds: integer(
      environment,
      'SESSION_LIFETIME_SECONDS',
      604_800,
      2_592_000,
    ),
    resendApiKey,
    resendFromEmail,
    resendTimeoutMs: integer(environment, 'RESEND_TIMEOUT_MS', 5000, 15_000),
  };
}

export type AuthConfig = ReturnType<typeof readAuthConfig>;
