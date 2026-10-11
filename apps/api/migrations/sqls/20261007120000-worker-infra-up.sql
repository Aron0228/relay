CREATE SCHEMA execution;

CREATE TABLE execution.run (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES auth."user" (id) ON DELETE SET NULL,
    script_name text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    view_token_hash varchar(64) NOT NULL CHECK (view_token_hash ~ '^[0-9a-f]{64}$'),
    cancel_requested boolean NOT NULL DEFAULT false,
    worker_pid integer,
    video_file text,
    error text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at timestamptz,
    ended_at timestamptz
);

CREATE TABLE execution.run_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES execution.run (id) ON DELETE CASCADE,
    sequence bigserial NOT NULL UNIQUE,
    type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX run_event_run_id_sequence_idx ON execution.run_event (run_id, sequence);
