CREATE TABLE public.marketplace_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL CHECK (btrim(name) <> ''),
  slug varchar(80) NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  icon_key varchar(50) NOT NULL
    CHECK (icon_key ~ '^[a-z][a-z0-9_]*$'),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at timestamptz,
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE UNIQUE INDEX marketplace_category_name_ci_key
  ON public.marketplace_category (lower(btrim(name)));

CREATE INDEX marketplace_category_active_order_idx
  ON public.marketplace_category (sort_order, name, id)
  WHERE archived_at IS NULL;


CREATE TABLE public.marketplace_place (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  name varchar(160) NOT NULL CHECK (btrim(name) <> ''),
  slug varchar(160) NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text NOT NULL CHECK (btrim(description) <> ''),
  cover_image_url text,
  address text NOT NULL CHECK (btrim(address) <> ''),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  google_maps_url text,
  phone_number varchar(32),
  website_url text,
  social_url text,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Beirut'
    CHECK (btrim(timezone) <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at timestamptz,
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(address, '')
    )
  ) STORED,

  CONSTRAINT marketplace_place_category_fk
    FOREIGN KEY (category_id)
    REFERENCES public.marketplace_category(id)
    ON DELETE RESTRICT,

  CONSTRAINT marketplace_place_cover_image_url_check
    CHECK (
      cover_image_url IS NULL OR
      cover_image_url ~ '^https://[^[:space:]]+$'
    ),

  CONSTRAINT marketplace_place_coordinates_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)),

  CONSTRAINT marketplace_place_latitude_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),

  CONSTRAINT marketplace_place_longitude_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

  CONSTRAINT marketplace_place_google_maps_url_check
    CHECK (
      google_maps_url IS NULL OR
      google_maps_url ~ '^https://[^[:space:]]+$'
    ),

  CONSTRAINT marketplace_place_phone_check
    CHECK (phone_number IS NULL OR btrim(phone_number) <> ''),

  CONSTRAINT marketplace_place_website_url_check
    CHECK (
      website_url IS NULL OR
      website_url ~ '^https://[^[:space:]]+$'
    ),

  CONSTRAINT marketplace_place_social_url_check
    CHECK (
      social_url IS NULL OR
      social_url ~ '^https://[^[:space:]]+$'
    ),

  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX marketplace_place_active_name_idx
  ON public.marketplace_place (name, id)
  WHERE archived_at IS NULL;

CREATE INDEX marketplace_place_active_category_idx
  ON public.marketplace_place (category_id, name, id)
  WHERE archived_at IS NULL;

CREATE INDEX marketplace_place_search_idx
  ON public.marketplace_place
  USING GIN (search_document)
  WHERE archived_at IS NULL;


CREATE TABLE public.marketplace_place_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL,
  image_url text NOT NULL
    CHECK (image_url ~ '^https://[^[:space:]]+$'),
  alternative_text varchar(300),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT marketplace_place_image_place_fk
    FOREIGN KEY (place_id)
    REFERENCES public.marketplace_place(id)
    ON DELETE CASCADE,

  CONSTRAINT marketplace_place_image_alt_check
    CHECK (
      alternative_text IS NULL OR
      btrim(alternative_text) <> ''
    ),

  UNIQUE (place_id, sort_order),
  UNIQUE (place_id, image_url)
);

CREATE INDEX marketplace_place_image_place_idx
  ON public.marketplace_place_image (place_id, sort_order, id);


CREATE TABLE public.marketplace_opening_hour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  opens_at time without time zone NOT NULL,
  closes_at time without time zone NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT marketplace_opening_hour_place_fk
    FOREIGN KEY (place_id)
    REFERENCES public.marketplace_place(id)
    ON DELETE CASCADE,

  CONSTRAINT marketplace_opening_hour_nonzero_interval_check
    CHECK (opens_at <> closes_at),

  UNIQUE (place_id, day_of_week, opens_at, closes_at)
);

CREATE INDEX marketplace_opening_hour_place_day_idx
  ON public.marketplace_opening_hour (
    place_id,
    day_of_week,
    opens_at,
    closes_at
  );


CREATE TABLE public.marketplace_favorite (
  user_id uuid NOT NULL,
  place_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT marketplace_favorite_pk
    PRIMARY KEY (user_id, place_id),

  CONSTRAINT marketplace_favorite_user_fk
    FOREIGN KEY (user_id)
    REFERENCES public.app_user(id)
    ON DELETE CASCADE,

  CONSTRAINT marketplace_favorite_place_fk
    FOREIGN KEY (place_id)
    REFERENCES public.marketplace_place(id)
    ON DELETE CASCADE
);

CREATE INDEX marketplace_favorite_place_user_idx
  ON public.marketplace_favorite (place_id, user_id);


CREATE TABLE public.marketplace_rating (
  user_id uuid NOT NULL,
  place_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT marketplace_rating_pk
    PRIMARY KEY (user_id, place_id),

  CONSTRAINT marketplace_rating_user_fk
    FOREIGN KEY (user_id)
    REFERENCES public.app_user(id)
    ON DELETE CASCADE,

  CONSTRAINT marketplace_rating_place_fk
    FOREIGN KEY (place_id)
    REFERENCES public.marketplace_place(id)
    ON DELETE CASCADE,

  CHECK (updated_at >= created_at)
);

CREATE INDEX marketplace_rating_place_rating_idx
  ON public.marketplace_rating (place_id, rating);


CREATE TABLE public.marketplace_place_post (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL,
  post_type text NOT NULL
    CHECK (post_type IN ('news', 'advertisement')),
  title varchar(160) NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL CHECK (btrim(body) <> ''),
  image_url text,
  starts_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at timestamptz,

  CONSTRAINT marketplace_place_post_place_fk
    FOREIGN KEY (place_id)
    REFERENCES public.marketplace_place(id)
    ON DELETE CASCADE,

  CONSTRAINT marketplace_place_post_image_url_check
    CHECK (
      image_url IS NULL OR
      image_url ~ '^https://[^[:space:]]+$'
    ),

  CONSTRAINT marketplace_place_post_schedule_check
    CHECK (ends_at IS NULL OR ends_at > starts_at),

  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX marketplace_place_post_active_schedule_idx
  ON public.marketplace_place_post (
    starts_at DESC,
    ends_at,
    place_id,
    id
  )
  WHERE archived_at IS NULL;

CREATE INDEX marketplace_place_post_active_place_idx
  ON public.marketplace_place_post (
    place_id,
    starts_at DESC,
    id
  )
  WHERE archived_at IS NULL;
