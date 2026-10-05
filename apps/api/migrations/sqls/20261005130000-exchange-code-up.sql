CREATE TABLE auth.exchange_code (
    code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    user_id uuid NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
    client_type text NOT NULL CHECK (client_type IN ('web', 'mobile')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
