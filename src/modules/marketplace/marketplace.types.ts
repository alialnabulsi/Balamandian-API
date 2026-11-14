export interface Category {
  id: string;
  name: string;
  slug: string;
  iconKey: string;
  sortOrder: number;
}

export interface PageOptions {
  page: number;
  limit: number;
}

export interface PlaceQuery extends PageOptions {
  search?: string;
  category?: string;
}

export type PostType = 'news' | 'advertisement';

export interface PostQuery extends PageOptions {
  type?: PostType;
  placeId?: string;
}

export interface PlaceSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  address: string;
  category: Omit<Category, 'sortOrder'>;
  averageRating: number;
  ratingCount: number;
  myRating: number | null;
  isFavorite: boolean;
}

export interface PlaceImage {
  id: string;
  imageUrl: string;
  alternativeText: string | null;
  sortOrder: number;
}

export interface OpeningHour {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface PlaceDetail extends PlaceSummary {
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  socialUrl: string | null;
  timezone: string;
  images: PlaceImage[];
  openingHours: OpeningHour[];
}

export interface Post {
  id: string;
  type: PostType;
  title: string;
  body: string;
  imageUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  isFavoritePlace: boolean;
  place: Pick<PlaceSummary, 'id' | 'name' | 'slug' | 'coverImageUrl'>;
}

export interface RatingResult {
  placeId: string;
  myRating: number | null;
  averageRating: number;
  ratingCount: number;
}

export interface FavoriteResult {
  placeId: string;
  isFavorite: boolean;
}

export interface PageRows<T> {
  items: T[];
  totalItems: number;
}

export interface Page<T> {
  items: T[];
  pagination: PageOptions & {
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// Narrow persistence contract keeps the service independent of PostgreSQL and Express.
export interface MarketplacePersistence {
  categories(): Promise<Category[]>;
  places(userId: string, query: PlaceQuery): Promise<PageRows<PlaceSummary>>;
  place(userId: string, placeId: string): Promise<PlaceDetail | undefined>;
  posts(userId: string, query: PostQuery, now: Date): Promise<PageRows<Post>>;
  favorite(
    userId: string,
    placeId: string,
    value: boolean,
  ): Promise<FavoriteResult | undefined>;
  rating(
    userId: string,
    placeId: string,
    value: number | null,
    now: Date,
  ): Promise<RatingResult | undefined>;
}
