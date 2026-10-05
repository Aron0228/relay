CREATE TABLE auth.oauth_transaction (
    state text PRIMARY KEY,
    code_verifier text NOT NULL
        CHECK (length(code_verifier) BETWEEN 43 AND 128)
        CHECK (code_verifier ~ '^[A-Za-z0-9._~-]+$'),
    client_type text NOT NULL CHECK (client_type IN ('web', 'mobile')),
    redirect_uri text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX oauth_transaction_expires_at_idx ON auth.oauth_transaction (expires_at);
