ALTER TABLE auth.environment
    ALTER COLUMN base_url DROP NOT NULL,
    ADD COLUMN repository_id uuid,
    ADD COLUMN allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_origins) = 'array'),
    ADD CONSTRAINT environment_repository_fk FOREIGN KEY (repository_id, workspace_id) REFERENCES github.repository(id, workspace_id) ON DELETE SET NULL (repository_id);
ALTER TABLE github.repository ALTER COLUMN default_environment_id DROP NOT NULL;

CREATE TEMP TABLE environment_mapping ON COMMIT DROP AS
SELECT environment_id, repository_id,
    CASE WHEN row_number() OVER (PARTITION BY environment_id ORDER BY repository_id) = 1
        THEN environment_id ELSE gen_random_uuid() END AS new_id
FROM (
    SELECT default_environment_id AS environment_id, id AS repository_id FROM github.repository WHERE default_environment_id IS NOT NULL
    UNION SELECT environment_id, repository_id FROM execution.task
) links;

INSERT INTO auth.environment (id, workspace_id, name, base_url, created_at, deleted_at, repository_id)
SELECT m.new_id, e.workspace_id, e.name, e.base_url, e.created_at, e.deleted_at, m.repository_id
FROM environment_mapping m JOIN auth.environment e ON e.id = m.environment_id WHERE m.new_id <> m.environment_id;
UPDATE auth.environment e SET repository_id = m.repository_id
FROM environment_mapping m WHERE m.new_id = m.environment_id AND e.id = m.environment_id;

ALTER TABLE execution.run DROP CONSTRAINT run_task_context_fk;
UPDATE execution.run r SET environment_id = m.new_id FROM execution.task t, environment_mapping m
WHERE r.task_id = t.id AND m.repository_id = t.repository_id AND m.environment_id = t.environment_id;
UPDATE execution.task t SET environment_id = m.new_id FROM environment_mapping m
WHERE m.repository_id = t.repository_id AND m.environment_id = t.environment_id;
ALTER TABLE execution.run ADD CONSTRAINT run_task_context_fk FOREIGN KEY (task_id, workspace_id, environment_id)
    REFERENCES execution.task(id, workspace_id, environment_id);
UPDATE github.repository r SET default_environment_id = m.new_id FROM environment_mapping m
WHERE m.repository_id = r.id AND m.environment_id = r.default_environment_id;

UPDATE auth.environment SET allowed_origins = jsonb_build_array(regexp_replace(base_url, '/+$', '')), base_url = NULL
WHERE base_url LIKE '%*%';
UPDATE github.repository r SET default_environment_id = NULL FROM auth.environment e
WHERE e.id = r.default_environment_id AND e.base_url IS NULL;
CREATE INDEX environment_repository_idx ON auth.environment(repository_id, workspace_id);
