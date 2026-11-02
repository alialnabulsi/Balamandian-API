export interface Credentials {
  identifier: string;
  password: string;
}

export interface SisIdentity {
  userId: string;
  email: string;
}

export interface SisGateway {
  verify(credentials: Credentials): Promise<SisIdentity>;
}

export interface OtpMailer {
  sendOtp(email: string, otp: string): Promise<void>;
}

export interface AppUser {
  id: string;
  sisUserId: string;
  institutionalEmail: string;
  emailVerifiedAt: Date | null;
  status: 'active' | 'disabled';
}

export interface PendingRegistration {
  id: string;
  sisUserId: string;
  institutionalEmail: string;
  otpVerifier: string;
  otpExpiresAt: Date;
  failedAttempts: number;
  resendCount: number;
  nextSendAt: Date;
  registrationExpiresAt: Date;
  deliveryState: 'sending' | 'sent' | 'failed';
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSession {
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: AppUser;
  expiresAt: Date;
}
