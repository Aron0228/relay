DROP TABLE execution.stage_request;
ALTER TABLE execution.run DROP CONSTRAINT run_id_task_unique;

ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
UPDATE execution.run_result SET type = 'browser-test', status = 'inconclusive', confidence = 0,
    result = jsonb_set(result, '{verdict}', '"inconclusive"'::jsonb)
WHERE type = 'issue-reproduction';
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check
    CHECK (status IN ('passed', 'failed', 'inconclusive'));
