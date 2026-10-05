CREATE SCHEMA auth;

CREATE TABLE auth."user" (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id bigint NOT NULL UNIQUE,
    username text NOT NULL
);

CREATE TABLE auth.session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    user_profile jsonb NOT NULL CHECK (jsonb_typeof(user_profile) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at),
    CHECK (expires_at <= absolute_expires_at)
);
