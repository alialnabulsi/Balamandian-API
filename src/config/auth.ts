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
  const secure = environment.SMTP_SECURE ?? 'true';
  if (!['true', 'false'].includes(secure)) {
    throw new Error('SMTP_SECURE must be true or false.');
  }
  const smtpHost = required(environment, 'SMTP_HOST');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(smtpHost);
  const localSmtp = loopback && environment.NODE_ENV !== 'production';
  const smtpUser = environment.SMTP_USER;
  const smtpPassword = environment.SMTP_PASSWORD;
  if (!localSmtp || smtpUser || smtpPassword) {
    required(environment, 'SMTP_USER');
    required(environment, 'SMTP_PASSWORD');
  }
  const smtpFrom = required(environment, 'SMTP_FROM');
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(smtpFrom)) {
    throw new Error('SMTP_FROM must be a single email address.');
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
    smtp: {
      host: smtpHost,
      port: integer(
        environment,
        'SMTP_PORT',
        secure === 'true' ? 465 : 587,
        65_535,
      ),
      secure: secure === 'true',
      requireTLS: !localSmtp && secure === 'false',
      ...(smtpUser && smtpPassword
        ? { auth: { user: smtpUser, pass: smtpPassword } }
        : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10_000,
      // The transport accepts only application-created text, never files or URLs.
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false as const,
      debug: false,
    },
    smtpFrom,
  };
}

export type AuthConfig = ReturnType<typeof readAuthConfig>;
