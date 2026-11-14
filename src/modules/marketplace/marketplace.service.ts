import { HttpError } from '../../shared/http-error.js';
import type {
  MarketplacePersistence,
  Page,
  PageOptions,
  PageRows,
  PlaceQuery,
  PostQuery,
} from './marketplace.types.js';

function found<T>(value: T | undefined): T {
  if (value === undefined)
    throw new HttpError(404, 'PLACE_NOT_FOUND', 'This place is unavailable.');
  return value;
}

function page<T>(rows: PageRows<T>, options: PageOptions): Page<T> {
  const totalPages = Math.ceil(rows.totalItems / options.limit);
  return {
    items: rows.items,
    pagination: {
      ...options,
      totalItems: rows.totalItems,
      totalPages,
      hasNextPage: options.page < totalPages,
      hasPreviousPage: options.page > 1,
    },
  };
}

export class MarketplaceService {
  constructor(
    private readonly repository: MarketplacePersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}

  categories() {
    return this.repository.categories();
  }

  async places(userId: string, query: PlaceQuery) {
    return page(await this.repository.places(userId, query), {
      page: query.page,
      limit: query.limit,
    });
  }

  async place(userId: string, placeId: string) {
    return found(await this.repository.place(userId, placeId));
  }

  async posts(userId: string, query: PostQuery) {
    return page(await this.repository.posts(userId, query, this.now()), {
      page: query.page,
      limit: query.limit,
    });
  }

  async favorite(userId: string, placeId: string, value: boolean) {
    return found(await this.repository.favorite(userId, placeId, value));
  }

  async rating(userId: string, placeId: string, value: number | null) {
    return found(
      await this.repository.rating(userId, placeId, value, this.now()),
    );
  }
}
