CREATE TABLE public.app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sis_user_id varchar(128) NOT NULL UNIQUE CHECK (btrim(sis_user_id) <> ''),
  institutional_email varchar(254) NOT NULL CHECK (institutional_email <> ''),
  email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'active' OR email_verified_at IS NOT NULL)
);

-- One retained challenge per canonical identity. Replacement rotates its opaque id.
CREATE TABLE public.pending_registration (
  id uuid PRIMARY KEY,
  sis_user_id varchar(128) NOT NULL UNIQUE CHECK (btrim(sis_user_id) <> ''),
  institutional_email varchar(254) NOT NULL CHECK (institutional_email <> ''),
  otp_verifier text NOT NULL CHECK (otp_verifier ~ '^[a-f0-9]{64}$'),
  otp_expires_at timestamptz NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  resend_count smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 3),
  next_send_at timestamptz NOT NULL,
  registration_expires_at timestamptz NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('sending', 'sent', 'failed')),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (otp_expires_at > created_at),
  CHECK (registration_expires_at > created_at),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX pending_registration_expiry_idx
  ON public.pending_registration (registration_expires_at);

CREATE TABLE public.app_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX app_session_user_idx ON public.app_session (user_id);
CREATE INDEX app_session_expiry_idx ON public.app_session (expires_at);
