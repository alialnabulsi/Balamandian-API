import { HttpError } from '../../shared/http-error.js';
import type { MemberQuery } from './profile.types.js';
function invalid(): never {
  throw new HttpError(
    400,
    'VALIDATION_ERROR',
    'Invalid profile request fields.',
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function userId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}
export function query(value: unknown, allowed: string[] = []) {
  const fields = object(value);
  for (const [key, v] of Object.entries(fields))
    if (!allowed.includes(key) || typeof v !== 'string') invalid();
  return fields;
}
export function members(value: unknown): MemberQuery {
  const fields = query(value, ['search', 'page', 'limit']);
  const integer = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (
      typeof v !== 'string' ||
      !/^[1-9][0-9]*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      invalid();
    return Number(v);
  };
  const search =
    typeof fields.search === 'string'
      ? fields.search.trim().replace(/^@/, '')
      : '';
  if (search.length > 100 || /\p{Cc}/u.test(search)) invalid();
  return {
    search,
    page: integer(fields.page, 1, 1000000),
    limit: integer(fields.limit, 20, 50),
  };
}
export function biography(value: unknown): string {
  const fields = object(value);
  if (
    Object.keys(fields).length !== 1 ||
    typeof fields.biography !== 'string' ||
    Array.from(fields.biography).length > 250 ||
    /[\p{Cc}&&[^\n]]/v.test(fields.biography)
  )
    invalid();
  return fields.biography.trim();
}
