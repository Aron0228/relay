DROP TABLE github.command_reply;
UPDATE execution.task SET feedback_status = 'pending', feedback_attempts = 0,
    feedback_next_attempt_at = NULL, feedback_lease_token = NULL, feedback_lease_expires_at = NULL
WHERE feedback_phase = 'progress';
ALTER TABLE execution.task DROP COLUMN feedback_phase;
