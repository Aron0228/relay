CREATE TABLE github.installation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
    workspace_id uuid NOT NULL REFERENCES auth.workspace(id),
    account_login text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id)
);

CREATE INDEX installation_workspace_idx ON github.installation(workspace_id);

CREATE TABLE github.repository (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    full_name text NOT NULL,
    default_environment_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (installation_id, workspace_id) REFERENCES github.installation(id, workspace_id),
    FOREIGN KEY (default_environment_id, workspace_id) REFERENCES auth.environment(id, workspace_id)
);
CREATE INDEX repository_workspace_idx ON github.repository(workspace_id);
CREATE INDEX repository_installation_idx ON github.repository(installation_id, workspace_id);
CREATE INDEX repository_environment_idx ON github.repository(default_environment_id, workspace_id);

CREATE TABLE github.issue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
    repository_id uuid NOT NULL REFERENCES github.repository(id),
    number integer NOT NULL CHECK (number > 0),
    url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id, number),
    UNIQUE (id, repository_id)
);

CREATE TABLE execution.task (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    environment_id uuid NOT NULL,
    repository_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    issue_title text NOT NULL,
    issue_body text NOT NULL DEFAULT '',
    source_comment_id bigint NOT NULL UNIQUE CHECK (source_comment_id > 0),
    source_comment_url text NOT NULL,
    requested_by uuid NOT NULL REFERENCES auth."user"(id),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
    outcome text CHECK (outcome IN ('reproduced', 'not_reproduced', 'inconclusive')),
    result jsonb CHECK (jsonb_typeof(result) = 'object'),
    feedback_status text NOT NULL DEFAULT 'pending'
        CHECK (feedback_status IN ('pending', 'sending', 'sent', 'failed')),
    feedback_comment_id bigint CHECK (feedback_comment_id > 0),
    feedback_error text,
    feedback_sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    queued_at timestamptz,
    started_at timestamptz,
    ended_at timestamptz,
    UNIQUE (id, workspace_id, environment_id),
    FOREIGN KEY (repository_id, workspace_id) REFERENCES github.repository(id, workspace_id),
    FOREIGN KEY (issue_id, repository_id) REFERENCES github.issue(id, repository_id),
    FOREIGN KEY (environment_id, workspace_id) REFERENCES auth.environment(id, workspace_id)
);
CREATE INDEX task_workspace_created_idx ON execution.task(workspace_id, created_at, id);
CREATE INDEX task_issue_idx ON execution.task(issue_id, repository_id);
CREATE INDEX task_environment_idx ON execution.task(environment_id, workspace_id);

ALTER TABLE execution.run
    ADD COLUMN task_id uuid,
    ADD COLUMN stage text CHECK (stage IN ('reproduction', 'step_verification', 'critic')),
    ADD COLUMN attempt integer CHECK (attempt > 0),
    ADD CONSTRAINT run_task_context_fk FOREIGN KEY (task_id, workspace_id, environment_id)
        REFERENCES execution.task(id, workspace_id, environment_id),
    ADD CONSTRAINT run_task_context_check CHECK (
        (task_id IS NULL AND stage IS NULL AND attempt IS NULL) OR
        (task_id IS NOT NULL AND workspace_id IS NOT NULL AND environment_id IS NOT NULL
            AND stage IS NOT NULL AND attempt IS NOT NULL)
    ),
    ADD CONSTRAINT run_task_stage_attempt_unique UNIQUE (task_id, stage, attempt);
