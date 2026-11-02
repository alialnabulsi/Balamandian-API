import { Resend } from 'resend';

import type { AuthConfig } from '../../config/auth.js';
import type { OtpMailer } from '../../modules/auth/auth.types.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ResendMailer implements OtpMailer {
  constructor(
    private readonly config: Pick<
      AuthConfig,
      'resendApiKey' | 'resendFromEmail' | 'resendTimeoutMs'
    >,
    private readonly emails: Pick<Resend['emails'], 'send'> = new Resend(
      config.resendApiKey,
      // Do not allow the SDK's RESEND_BASE_URL environment override to redirect secrets.
      { baseUrl: 'https://api.resend.com' },
    ).emails,
  ) {}

  async sendOtp(email: string, otp: string): Promise<void> {
    const signal = AbortSignal.timeout(this.config.resendTimeoutMs);
    try {
      const result: unknown = await this.emails.send(
        {
          from: this.config.resendFromEmail,
          to: email,
          subject: 'Your Balamandian verification code',
          text: `Your Balamandian verification code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
        },
        { signal },
      );
      if (
        signal.aborted ||
        !record(result) ||
        result.error !== null ||
        !record(result.data) ||
        typeof result.data.id !== 'string' ||
        !result.data.id.trim()
      ) {
        throw new Error(
          'Email provider did not accept the verification message.',
        );
      }
      // Success is provider acceptance, not confirmed delivery to the recipient.
    } catch {
      // Never propagate provider bodies, SDK exceptions, keys or email content.
      // AuthService retains the existing EMAIL_UNAVAILABLE response and send budget.
      throw new Error(
        'Email provider did not accept the verification message.',
      );
    }
  }
}
