DELETE FROM execution.run WHERE task_id IN (SELECT id FROM execution.task WHERE kind = 'pr_verification');
DELETE FROM execution.task WHERE kind = 'pr_verification';
DROP TABLE execution.pr_context;
ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check CHECK (
    (type = 'browser-test' AND status IN ('passed', 'failed', 'inconclusive')) OR
    (type IN ('issue-reproduction', 'step-verification', 'issue-critic') AND status IN ('reproduced', 'not_reproduced', 'inconclusive'))
);
ALTER TABLE execution.run DROP CONSTRAINT run_stage_check;
ALTER TABLE execution.run ADD CONSTRAINT run_stage_check CHECK (stage IN ('reproduction', 'step_verification', 'critic'));
ALTER TABLE execution.task DROP CONSTRAINT task_source_check, DROP CONSTRAINT task_pull_request_fk,
    DROP CONSTRAINT task_outcome_check,
    DROP COLUMN kind, DROP COLUMN pull_request_id, DROP COLUMN target_url, DROP COLUMN base_sha, DROP COLUMN head_sha;
ALTER TABLE execution.task ALTER COLUMN issue_id SET NOT NULL;
ALTER TABLE execution.task ADD CONSTRAINT task_outcome_check CHECK (outcome IN ('reproduced', 'not_reproduced', 'inconclusive'));
DROP TABLE github.pull_request;
