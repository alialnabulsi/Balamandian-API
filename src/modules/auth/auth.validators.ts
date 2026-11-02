import { HttpError } from '../../shared/http-error.js';
import type { Credentials } from './auth.types.js';

function invalid(): never {
  throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request fields.');
}

export function objectWithKeys(value: unknown, keys: string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid();
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  )
    invalid();
  return object;
}

export function credentials(value: unknown): Credentials {
  const object = objectWithKeys(value, ['identifier', 'password']);
  if (
    typeof object.identifier !== 'string' ||
    !object.identifier.trim() ||
    object.identifier.length > 254 ||
    /[\s\p{Cc}]/u.test(object.identifier.trim()) ||
    typeof object.password !== 'string' ||
    !object.password.length ||
    object.password.length > 1024 ||
    object.password.includes('\0')
  )
    invalid();
  return { identifier: object.identifier.trim(), password: object.password };
}

export function registrationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}

export function verification(value: unknown) {
  const object = objectWithKeys(value, ['pendingRegistrationId', 'otp']);
  if (typeof object.otp !== 'string' || !/^\d{6}$/.test(object.otp)) invalid();
  return { id: registrationId(object.pendingRegistrationId), otp: object.otp };
}

export function resend(value: unknown) {
  return registrationId(
    objectWithKeys(value, ['pendingRegistrationId']).pendingRegistrationId,
  );
}

export function validInstitutionalEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s<>@,;\p{Cc}]+@[^\s<>@,;\p{Cc}]+\.[^\s<>@,;\p{Cc}]+$/u.test(value)
  );
}
