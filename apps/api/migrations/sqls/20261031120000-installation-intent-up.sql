CREATE TABLE github.installation_intent (
    state_hash varchar(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
    workspace_id uuid NOT NULL REFERENCES auth.workspace(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
