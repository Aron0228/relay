ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check CHECK (
    (type = 'browser-test' AND status IN ('passed', 'failed', 'inconclusive')) OR
    (type = 'issue-reproduction' AND status IN ('reproduced', 'not_reproduced', 'inconclusive'))
);

ALTER TABLE execution.run ADD CONSTRAINT run_id_task_unique UNIQUE (id, task_id);

CREATE TABLE execution.stage_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES execution.task(id) ON DELETE CASCADE,
    source_run_id uuid NOT NULL UNIQUE,
    stage text NOT NULL CHECK (stage IN ('step_verification', 'critic')),
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    FOREIGN KEY (source_run_id, task_id) REFERENCES execution.run(id, task_id) ON DELETE CASCADE
);

CREATE INDEX stage_request_pending_idx ON execution.stage_request (created_at, id) WHERE consumed_at IS NULL;
