BEGIN;

INSERT INTO public.marketplace_category (
  id,
  name,
  slug,
  icon_key,
  sort_order
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Coffee & bites',
    'coffee-bites',
    'coffee',
    10
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Food & dining',
    'food-dining',
    'restaurant',
    20
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Books & printing',
    'books-printing',
    'books',
    30
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  icon_key = EXCLUDED.icon_key,
  sort_order = EXCLUDED.sort_order,
  updated_at = CURRENT_TIMESTAMP,
  archived_at = NULL;


INSERT INTO public.marketplace_place (
  id,
  category_id,
  name,
  slug,
  description,
  cover_image_url,
  address,
  latitude,
  longitude,
  google_maps_url,
  phone_number,
  website_url,
  social_url,
  timezone
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'The Olive Coffee House',
    'the-olive-coffee-house',
    'A sample campus coffee house offering hot drinks, cold drinks, pastries, and light bites.',
    NULL,
    'Balamand, Al Kurah, Lebanon',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'Asia/Beirut'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'The Garden Table',
    'the-garden-table',
    'A sample dining place offering casual meals and a relaxed gathering space.',
    NULL,
    'Balamand, Al Kurah, Lebanon',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'Asia/Beirut'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'Paper & Ink',
    'paper-and-ink',
    'A sample book and printing shop offering stationery, document printing, and study supplies.',
    NULL,
    'Balamand, Al Kurah, Lebanon',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'Asia/Beirut'
  )
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  cover_image_url = EXCLUDED.cover_image_url,
  address = EXCLUDED.address,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  google_maps_url = EXCLUDED.google_maps_url,
  phone_number = EXCLUDED.phone_number,
  website_url = EXCLUDED.website_url,
  social_url = EXCLUDED.social_url,
  timezone = EXCLUDED.timezone,
  updated_at = CURRENT_TIMESTAMP,
  archived_at = NULL;


INSERT INTO public.marketplace_opening_hour (
  id,
  place_id,
  day_of_week,
  opens_at,
  closes_at
)
VALUES
  (
    '40000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000001',
    1,
    '07:30',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000001',
    2,
    '07:30',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000103',
    '20000000-0000-4000-8000-000000000001',
    3,
    '07:30',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000104',
    '20000000-0000-4000-8000-000000000001',
    4,
    '07:30',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000105',
    '20000000-0000-4000-8000-000000000001',
    5,
    '07:30',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000106',
    '20000000-0000-4000-8000-000000000001',
    6,
    '08:00',
    '20:00'
  ),
  (
    '40000000-0000-4000-8000-000000000107',
    '20000000-0000-4000-8000-000000000001',
    7,
    '09:00',
    '18:00'
  ),

  (
    '40000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000002',
    1,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000202',
    '20000000-0000-4000-8000-000000000002',
    2,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000203',
    '20000000-0000-4000-8000-000000000002',
    3,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000204',
    '20000000-0000-4000-8000-000000000002',
    4,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000205',
    '20000000-0000-4000-8000-000000000002',
    5,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000206',
    '20000000-0000-4000-8000-000000000002',
    6,
    '11:00',
    '23:00'
  ),
  (
    '40000000-0000-4000-8000-000000000207',
    '20000000-0000-4000-8000-000000000002',
    7,
    '11:00',
    '23:00'
  ),

  (
    '40000000-0000-4000-8000-000000000301',
    '20000000-0000-4000-8000-000000000003',
    1,
    '08:00',
    '18:00'
  ),
  (
    '40000000-0000-4000-8000-000000000302',
    '20000000-0000-4000-8000-000000000003',
    2,
    '08:00',
    '18:00'
  ),
  (
    '40000000-0000-4000-8000-000000000303',
    '20000000-0000-4000-8000-000000000003',
    3,
    '08:00',
    '18:00'
  ),
  (
    '40000000-0000-4000-8000-000000000304',
    '20000000-0000-4000-8000-000000000003',
    4,
    '08:00',
    '18:00'
  ),
  (
    '40000000-0000-4000-8000-000000000305',
    '20000000-0000-4000-8000-000000000003',
    5,
    '08:00',
    '18:00'
  ),
  (
    '40000000-0000-4000-8000-000000000306',
    '20000000-0000-4000-8000-000000000003',
    6,
    '09:00',
    '14:00'
  )
ON CONFLICT (id) DO UPDATE SET
  place_id = EXCLUDED.place_id,
  day_of_week = EXCLUDED.day_of_week,
  opens_at = EXCLUDED.opens_at,
  closes_at = EXCLUDED.closes_at;


INSERT INTO public.marketplace_place_post (
  id,
  place_id,
  post_type,
  title,
  body,
  image_url,
  starts_at,
  ends_at
)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'news',
    'New seasonal drinks',
    'The Olive Coffee House has added a sample seasonal drinks selection.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'advertisement',
    'Student coffee offer',
    'A sample promotional offer for students visiting The Olive Coffee House.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'news',
    'Updated dining menu',
    'The Garden Table has introduced a sample updated dining menu.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000002',
    'advertisement',
    'Campus meal offer',
    'A sample promotional meal offer from The Garden Table.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000003',
    'news',
    'Printing services update',
    'Paper & Ink has added a sample update about its printing services.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000003',
    'advertisement',
    'Study supplies offer',
    'A sample promotional offer for selected study supplies at Paper & Ink.',
    NULL,
    '2026-01-01 00:00:00+02',
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  place_id = EXCLUDED.place_id,
  post_type = EXCLUDED.post_type,
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  image_url = EXCLUDED.image_url,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  updated_at = CURRENT_TIMESTAMP,
  archived_at = NULL;

COMMIT;
