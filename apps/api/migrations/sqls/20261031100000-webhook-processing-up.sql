ALTER TABLE github.webhook_delivery
    DROP CONSTRAINT webhook_delivery_status_check,
    ADD CONSTRAINT webhook_delivery_status_check CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'rejected', 'failed')),
    ADD COLUMN processing_token uuid,
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN processed_at timestamptz,
    ADD COLUMN processing_error text,
    ADD COLUMN task_id uuid REFERENCES execution.task(id) ON DELETE SET NULL,
    ADD CONSTRAINT webhook_delivery_lease_check CHECK (
      (status = 'processing') = (processing_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    );

CREATE INDEX webhook_delivery_retry_idx ON github.webhook_delivery(next_attempt_at, received_at)
    WHERE event_type = 'issue_comment' AND status IN ('received', 'failed', 'processing');
