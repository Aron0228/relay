ALTER TABLE execution.run
    DROP CONSTRAINT run_task_stage_attempt_unique,
    DROP CONSTRAINT run_task_context_check,
    DROP CONSTRAINT run_task_context_fk,
    DROP COLUMN attempt,
    DROP COLUMN stage,
    DROP COLUMN task_id;

DROP TABLE execution.task;
DROP TABLE github.issue;
DROP TABLE github.repository;
DROP TABLE github.installation;
