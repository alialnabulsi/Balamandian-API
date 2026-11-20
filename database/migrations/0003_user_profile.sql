-- Additive upgrade: existing accounts, sessions and marketplace data are preserved.
-- Legacy pending challenges cannot create an incomplete profile: restart registration.
ALTER TABLE public.pending_registration ADD COLUMN identity_snapshot jsonb
  CHECK (identity_snapshot IS NULL OR
    (jsonb_typeof(identity_snapshot) = 'object' AND octet_length(identity_snapshot::text) <= 16384));

CREATE TABLE public.user_profile (
  user_id uuid PRIMARY KEY REFERENCES public.app_user(id) ON DELETE CASCADE,
  username varchar(30) NOT NULL CHECK (username ~ '^[a-z][a-z0-9.]{2,29}$'),
  first_name varchar(100) NOT NULL CHECK (btrim(first_name) <> ''),
  last_name varchar(100) NOT NULL CHECK (btrim(last_name) <> ''),
  roles text[] NOT NULL CHECK (cardinality(roles) BETWEEN 1 AND 16),
  academic jsonb NOT NULL CHECK (jsonb_typeof(academic) = 'object' AND octet_length(academic::text) <= 12288),
  biography text NOT NULL DEFAULT '' CHECK (char_length(biography) <= 250),
  identity_synced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX user_profile_username_unique ON public.user_profile (lower(username));

-- One normalized, metadata-free WebP per application UUID; never part of profile JSON.
CREATE TABLE public.user_avatar (
  user_id uuid PRIMARY KEY REFERENCES public.user_profile(user_id) ON DELETE CASCADE,
  version uuid NOT NULL DEFAULT gen_random_uuid(),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.user_follow (
  follower_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX user_follow_reverse_idx ON public.user_follow (following_id, follower_id);
