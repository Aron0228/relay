CREATE SCHEMA github;

CREATE TABLE github.webhook_delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid NOT NULL UNIQUE,
    event_type text NOT NULL,
    status text NOT NULL DEFAULT 'received' CHECK (status = 'received'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
