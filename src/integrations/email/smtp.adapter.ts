import nodemailer from 'nodemailer';

import type { AuthConfig } from '../../config/auth.js';
import type { OtpMailer } from '../../modules/auth/auth.types.js';

export class SmtpMailer implements OtpMailer {
  private readonly transport;

  constructor(private readonly config: Pick<AuthConfig, 'smtp' | 'smtpFrom'>) {
    this.transport = nodemailer.createTransport(config.smtp);
  }

  async sendOtp(email: string, otp: string) {
    const result = await this.transport.sendMail({
      from: this.config.smtpFrom,
      to: email,
      subject: 'Your Balamandian verification code',
      text: `Your Balamandian verification code is ${otp}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
    });
    if (!result.accepted.length || result.rejected.length) {
      throw new Error('SMTP did not accept the verification message.');
    }
  }

  close() {
    this.transport.close();
  }
}
