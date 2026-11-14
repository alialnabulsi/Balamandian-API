import type { Pool, PoolClient } from 'pg';

import type {
  Category,
  MarketplacePersistence,
  OpeningHour,
  PlaceDetail,
  PlaceImage,
  PlaceQuery,
  PlaceSummary,
  Post,
  PostQuery,
  PostType,
  RatingResult,
} from './marketplace.types.js';

interface PlaceRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  address: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  iconKey: string;
  averageRating: string;
  ratingCount: string;
  myRating: number | null;
  isFavorite: boolean;
}

// A left-joined page has one null-ID sentinel row when the page is empty.
type PageRow<T> = (T & { total: string }) | { id: null; total: string };

interface DetailRow extends PlaceRow {
  latitude: string | null;
  longitude: string | null;
  googleMapsUrl: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  socialUrl: string | null;
  timezone: string;
}

interface PostRow {
  id: string;
  type: PostType;
  title: string;
  body: string;
  imageUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
  isFavoritePlace: boolean;
  placeId: string;
  placeName: string;
  placeSlug: string;
  coverImageUrl: string | null;
}

const activePlace = `FROM public.marketplace_place p
  JOIN public.marketplace_category c ON c.id = p.category_id`;
const active = 'p.archived_at IS NULL AND c.archived_at IS NULL';
const placeColumns = `p.id, p.name, p.slug, p.description, p.cover_image_url AS "coverImageUrl",
  p.address, c.id AS "categoryId", c.name AS "categoryName", c.slug AS "categorySlug",
  c.icon_key AS "iconKey", stats.average AS "averageRating", stats.count AS "ratingCount",
  mine.rating AS "myRating", (f.user_id IS NOT NULL) AS "isFavorite"`;
const placeRelations = `${activePlace}
  LEFT JOIN LATERAL (
    SELECT coalesce(avg(r.rating), 0) AS average, count(*) AS count
    FROM public.marketplace_rating r WHERE r.place_id = p.id
  ) stats ON true
  LEFT JOIN public.marketplace_rating mine ON mine.place_id = p.id AND mine.user_id = $1
  LEFT JOIN public.marketplace_favorite f ON f.place_id = p.id AND f.user_id = $1`;

function summary(row: PlaceRow): PlaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    address: row.address,
    category: {
      id: row.categoryId,
      name: row.categoryName,
      slug: row.categorySlug,
      iconKey: row.iconKey,
    },
    averageRating: Math.round(Number(row.averageRating) * 10) / 10,
    ratingCount: Number(row.ratingCount),
    myRating: row.myRating,
    isFavorite: row.isFavorite,
  };
}

function post(row: PostRow): Post {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    isFavoritePlace: row.isFavoritePlace,
    place: {
      id: row.placeId,
      name: row.placeName,
      slug: row.placeSlug,
      coverImageUrl: row.coverImageUrl,
    },
  };
}

export class MarketplaceRepository implements MarketplacePersistence {
  constructor(private readonly pool: Pool) {}

  async categories(): Promise<Category[]> {
    const result = await this.pool.query<Category>(
      `SELECT id, name, slug, icon_key AS "iconKey", sort_order AS "sortOrder"
       FROM public.marketplace_category WHERE archived_at IS NULL ORDER BY sort_order, name, id`,
    );
    return result.rows;
  }

  async places(userId: string, query: PlaceQuery) {
    // The total and page share one statement snapshot, including empty pages.
    // Ratings are aggregated before any other relations can multiply rows.
    const result = await this.pool.query<PageRow<PlaceRow>>(
      `WITH filtered AS (
        SELECT ${placeColumns} ${placeRelations}
        WHERE ${active} AND ($3::text IS NULL OR c.slug = $3)
          AND ($2::text IS NULL OR p.search_document @@ plainto_tsquery('simple', $2)
            OR strpos(lower(p.name), lower($2)) > 0
            OR strpos(lower(p.description), lower($2)) > 0
            OR strpos(lower(p.address), lower($2)) > 0
            OR strpos(lower(c.name), lower($2)) > 0
            OR strpos(lower(c.slug), lower($2)) > 0)
      ) SELECT page.*, totals.total FROM (SELECT count(*) AS total FROM filtered) totals
        LEFT JOIN LATERAL (SELECT * FROM filtered
          ORDER BY "isFavorite" DESC, "averageRating" DESC, name ASC, id ASC
          LIMIT $4 OFFSET $5) page ON true
        ORDER BY page."isFavorite" DESC, page."averageRating" DESC, page.name ASC, page.id ASC`,
      [
        userId,
        query.search ?? null,
        query.category ?? null,
        query.limit,
        (query.page - 1) * query.limit,
      ],
    );
    return {
      items: result.rows.filter((row) => row.id !== null).map(summary),
      totalItems: Number(result.rows[0]?.total ?? 0),
    };
  }

  async place(
    userId: string,
    placeId: string,
  ): Promise<PlaceDetail | undefined> {
    return this.transaction(async (client) => {
      const result = await client.query<DetailRow>(
        `SELECT ${placeColumns}, p.latitude, p.longitude, p.google_maps_url AS "googleMapsUrl",
          p.phone_number AS "phoneNumber", p.website_url AS "websiteUrl", p.social_url AS "socialUrl", p.timezone
         ${placeRelations} WHERE ${active} AND p.id = $2`,
        [userId, placeId],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const images = await client.query<PlaceImage>(
        `SELECT id, image_url AS "imageUrl", alternative_text AS "alternativeText", sort_order AS "sortOrder"
         FROM public.marketplace_place_image WHERE place_id = $1 ORDER BY sort_order, id`,
        [placeId],
      );
      const hours = await client.query<OpeningHour>(
        `SELECT day_of_week AS "dayOfWeek", to_char(opens_at, 'HH24:MI') AS "opensAt",
          to_char(closes_at, 'HH24:MI') AS "closesAt"
         FROM public.marketplace_opening_hour WHERE place_id = $1
         ORDER BY day_of_week, opens_at, closes_at, id`,
        [placeId],
      );
      return {
        ...summary(row),
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        googleMapsUrl: row.googleMapsUrl,
        phoneNumber: row.phoneNumber,
        websiteUrl: row.websiteUrl,
        socialUrl: row.socialUrl,
        timezone: row.timezone,
        images: images.rows,
        openingHours: hours.rows,
      };
    }, true);
  }

  async posts(userId: string, query: PostQuery, now: Date) {
    const result = await this.pool.query<PageRow<PostRow>>(
      `WITH filtered AS (
        SELECT post.id, post.post_type AS type, post.title, post.body, post.image_url AS "imageUrl",
          post.starts_at AS "startsAt", post.ends_at AS "endsAt", (f.user_id IS NOT NULL) AS "isFavoritePlace",
          p.id AS "placeId", p.name AS "placeName", p.slug AS "placeSlug", p.cover_image_url AS "coverImageUrl"
        FROM public.marketplace_place_post post
        JOIN public.marketplace_place p ON p.id = post.place_id
        JOIN public.marketplace_category c ON c.id = p.category_id
        LEFT JOIN public.marketplace_favorite f ON f.place_id = p.id AND f.user_id = $1
        WHERE ${active} AND post.archived_at IS NULL AND post.starts_at <= $2
          AND (post.ends_at IS NULL OR post.ends_at > $2)
          AND ($3::text IS NULL OR post.post_type = $3) AND ($4::uuid IS NULL OR p.id = $4)
      ) SELECT page.*, totals.total FROM (SELECT count(*) AS total FROM filtered) totals
        LEFT JOIN LATERAL (SELECT * FROM filtered
          ORDER BY "isFavoritePlace" DESC, "startsAt" DESC, id DESC LIMIT $5 OFFSET $6) page ON true
        ORDER BY page."isFavoritePlace" DESC, page."startsAt" DESC, page.id DESC`,
      [
        userId,
        now,
        query.type ?? null,
        query.placeId ?? null,
        query.limit,
        (query.page - 1) * query.limit,
      ],
    );
    return {
      items: result.rows.filter((row) => row.id !== null).map(post),
      totalItems: Number(result.rows[0]?.total ?? 0),
    };
  }

  async favorite(userId: string, placeId: string, value: boolean) {
    return this.withActivePlace(placeId, async (client) => {
      if (value) {
        await client.query(
          `INSERT INTO public.marketplace_favorite (user_id, place_id)
          VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, placeId],
        );
      } else {
        await client.query(
          'DELETE FROM public.marketplace_favorite WHERE user_id = $1 AND place_id = $2',
          [userId, placeId],
        );
      }
      return { placeId, isFavorite: value };
    });
  }

  async rating(
    userId: string,
    placeId: string,
    value: number | null,
    now: Date,
  ) {
    return this.withActivePlace(placeId, async (client) => {
      if (value === null) {
        await client.query(
          'DELETE FROM public.marketplace_rating WHERE user_id = $1 AND place_id = $2',
          [userId, placeId],
        );
      } else {
        await client.query(
          `INSERT INTO public.marketplace_rating AS existing (user_id, place_id, rating, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $4) ON CONFLICT (user_id, place_id) DO UPDATE
          SET rating = EXCLUDED.rating,
            updated_at = greatest(existing.updated_at, EXCLUDED.updated_at)`,
          [userId, placeId, value, now],
        );
      }
      const result = await client.query<{ average: string; count: string }>(
        `SELECT coalesce(round(avg(rating), 1), 0) AS average, count(*) AS count
         FROM public.marketplace_rating WHERE place_id = $1`,
        [placeId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Rating aggregate returned no row.');
      const rating: RatingResult = {
        placeId,
        myRating: value,
        averageRating: Number(row.average),
        ratingCount: Number(row.count),
      };
      return rating;
    });
  }

  private withActivePlace<T>(
    placeId: string,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    return this.transaction(async (client) => {
      // Serialize feature mutations per place; category sharing prevents an archive race.
      const place = await client.query(
        `SELECT p.id ${activePlace} WHERE ${active} AND p.id = $1
        FOR UPDATE OF p FOR SHARE OF c`,
        [placeId],
      );
      if (place.rowCount !== 1) return undefined;
      return operation(client);
    });
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query(
        readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
      );
      const result = await operation(client);
      await client.query('COMMIT');
      committed = true;
      return result;
    } finally {
      try {
        if (!committed) await client.query('ROLLBACK');
      } finally {
        client.release(!committed);
      }
    }
  }
}
