import { HttpError } from '../../shared/http-error.js';
import type {
  PageOptions,
  PlaceQuery,
  PostQuery,
} from './marketplace.types.js';

function invalid(): never {
  throw new HttpError(
    400,
    'VALIDATION_ERROR',
    'Invalid marketplace request fields.',
  );
}

function queryFields(value: unknown, allowed: string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid();
  const fields = value as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key) || typeof fields[key] !== 'string') invalid();
  }
  return fields;
}

function integer(
  value: unknown,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) invalid();
  return number;
}

function paging(fields: Record<string, unknown>): PageOptions {
  const page = integer(fields.page, 1);
  const limit = integer(fields.limit, 20, 50);
  if (!Number.isSafeInteger((page - 1) * limit)) invalid();
  return { page, limit };
}

export function emptyQuery(value: unknown): void {
  queryFields(value, []);
}

export function placeId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}

export function places(value: unknown): PlaceQuery {
  const fields = queryFields(value, ['search', 'category', 'page', 'limit']);
  const result: PlaceQuery = paging(fields);
  if (fields.search !== undefined) {
    const search = (fields.search as string).trim();
    if (search.length < 1 || search.length > 100 || /\p{Cc}/u.test(search))
      invalid();
    result.search = search;
  }
  if (fields.category !== undefined) {
    const category = fields.category as string;
    if (category.length > 80 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(category))
      invalid();
    result.category = category;
  }
  return result;
}

export function posts(value: unknown): PostQuery {
  const fields = queryFields(value, ['type', 'placeId', 'page', 'limit']);
  const result: PostQuery = paging(fields);
  if (fields.type !== undefined) {
    if (fields.type !== 'news' && fields.type !== 'advertisement') invalid();
    result.type = fields.type;
  }
  if (fields.placeId !== undefined) result.placeId = placeId(fields.placeId);
  return result;
}

export function rating(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid();
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 1 ||
    !Object.hasOwn(fields, 'rating') ||
    typeof fields.rating !== 'number' ||
    !Number.isInteger(fields.rating) ||
    fields.rating < 1 ||
    fields.rating > 5
  )
    invalid();
  return fields.rating;
}
