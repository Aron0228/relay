ALTER TABLE execution.run ADD COLUMN queued_at timestamptz;
UPDATE execution.run SET queued_at = created_at;
ALTER TABLE execution.run ALTER COLUMN queued_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE execution.run ALTER COLUMN queued_at SET NOT NULL;

CREATE TABLE execution.worker_slot (
    run_id uuid PRIMARY KEY REFERENCES execution.run (id) ON DELETE CASCADE,
    queue_name text NOT NULL,
    position bigserial NOT NULL UNIQUE,
    dispatched_at timestamptz,
    token uuid,
    expires_at timestamptz,
    CHECK ((token IS NULL) = (expires_at IS NULL))
);

CREATE INDEX worker_slot_queue_position_idx ON execution.worker_slot (queue_name, position);
CREATE INDEX worker_slot_expiry_idx ON execution.worker_slot (expires_at) WHERE token IS NOT NULL;
