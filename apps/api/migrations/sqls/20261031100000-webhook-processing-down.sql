DROP INDEX github.webhook_delivery_retry_idx;
ALTER TABLE github.webhook_delivery
    DROP CONSTRAINT webhook_delivery_status_check,
    DROP CONSTRAINT webhook_delivery_lease_check;
UPDATE github.webhook_delivery SET status = 'received';
ALTER TABLE github.webhook_delivery
    ADD CONSTRAINT webhook_delivery_status_check CHECK (status = 'received'),
    DROP COLUMN task_id,
    DROP COLUMN processing_error,
    DROP COLUMN processed_at,
    DROP COLUMN next_attempt_at,
    DROP COLUMN attempts,
    DROP COLUMN lease_expires_at,
    DROP COLUMN processing_token;
