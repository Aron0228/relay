ALTER TABLE execution.task
    ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN feedback_attempts integer NOT NULL DEFAULT 0 CHECK (feedback_attempts >= 0),
    ADD COLUMN feedback_next_attempt_at timestamptz,
    ADD COLUMN feedback_lease_token uuid,
    ADD COLUMN feedback_lease_expires_at timestamptz,
    ADD CONSTRAINT feedback_lease_pair CHECK ((feedback_lease_token IS NULL) = (feedback_lease_expires_at IS NULL));

UPDATE execution.task SET feedback_status = 'pending' WHERE feedback_status = 'sending';

ALTER TABLE execution.stage_request ADD COLUMN run_id uuid UNIQUE REFERENCES execution.run(id) ON DELETE SET NULL;

CREATE INDEX task_feedback_due_idx ON execution.task (feedback_next_attempt_at, id)
    WHERE ended_at IS NOT NULL AND feedback_status IN ('pending', 'sending', 'failed');

ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check CHECK (
    (type = 'browser-test' AND status IN ('passed', 'failed', 'inconclusive')) OR
    (type IN ('issue-reproduction', 'step-verification', 'issue-critic') AND status IN ('reproduced', 'not_reproduced', 'inconclusive'))
);
