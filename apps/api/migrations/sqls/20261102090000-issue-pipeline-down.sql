ALTER TABLE execution.stage_request DROP COLUMN run_id;
DROP INDEX execution.task_feedback_due_idx;
ALTER TABLE execution.task DROP CONSTRAINT feedback_lease_pair,
    DROP COLUMN cancel_requested, DROP COLUMN feedback_attempts,
    DROP COLUMN feedback_next_attempt_at, DROP COLUMN feedback_lease_token, DROP COLUMN feedback_lease_expires_at;
ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
UPDATE execution.run_result SET type = 'issue-reproduction' WHERE type IN ('step-verification', 'issue-critic');
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check CHECK (
    (type = 'browser-test' AND status IN ('passed', 'failed', 'inconclusive')) OR
    (type = 'issue-reproduction' AND status IN ('reproduced', 'not_reproduced', 'inconclusive'))
);
