CREATE TABLE github.pull_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id bigint NOT NULL UNIQUE CHECK (github_id > 0),
    repository_id uuid NOT NULL REFERENCES github.repository(id),
    number integer NOT NULL CHECK (number > 0),
    url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id, number),
    UNIQUE (id, repository_id)
);

ALTER TABLE execution.task
    ALTER COLUMN issue_id DROP NOT NULL,
    ADD COLUMN kind text NOT NULL DEFAULT 'issue_reproduction'
        CHECK (kind IN ('issue_reproduction', 'pr_verification')),
    ADD COLUMN pull_request_id uuid,
    ADD COLUMN target_url text,
    ADD COLUMN base_sha text,
    ADD COLUMN head_sha text,
    ADD CONSTRAINT task_pull_request_fk FOREIGN KEY (pull_request_id, repository_id)
        REFERENCES github.pull_request(id, repository_id),
    ADD CONSTRAINT task_source_check CHECK (
        (kind = 'issue_reproduction' AND issue_id IS NOT NULL AND pull_request_id IS NULL) OR
        (kind = 'pr_verification' AND issue_id IS NULL AND pull_request_id IS NOT NULL
            AND target_url IS NOT NULL AND base_sha IS NOT NULL AND head_sha IS NOT NULL)
    );
ALTER TABLE execution.task DROP CONSTRAINT task_outcome_check;
ALTER TABLE execution.task ADD CONSTRAINT task_outcome_check CHECK (
    outcome IS NULL OR
    (kind = 'issue_reproduction' AND outcome IN ('reproduced', 'not_reproduced', 'inconclusive')) OR
    (kind = 'pr_verification' AND outcome IN ('fixed', 'not_fixed', 'inconclusive'))
);
CREATE INDEX task_pull_request_idx ON execution.task(pull_request_id, created_at DESC, id DESC);

ALTER TABLE execution.run DROP CONSTRAINT run_stage_check;
ALTER TABLE execution.run ADD CONSTRAINT run_stage_check
    CHECK (stage IN ('reproduction', 'step_verification', 'critic', 'fix_verification'));
ALTER TABLE execution.run_result DROP CONSTRAINT run_result_status_check;
ALTER TABLE execution.run_result ADD CONSTRAINT run_result_status_check CHECK (
    (type = 'browser-test' AND status IN ('passed', 'failed', 'inconclusive')) OR
    (type IN ('issue-reproduction', 'step-verification', 'issue-critic') AND status IN ('reproduced', 'not_reproduced', 'inconclusive')) OR
    (type = 'fix-verification' AND status IN ('fixed', 'not_fixed', 'inconclusive'))
);

CREATE TABLE execution.pr_context (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL UNIQUE REFERENCES execution.task(id) ON DELETE CASCADE,
    head_sha text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collecting', 'completed', 'failed', 'cancelled')),
    data jsonb CHECK (jsonb_typeof(data) = 'object'),
    model text,
    prompt_version text,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
    metrics jsonb,
    error text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_token uuid,
    lease_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX pr_context_pending_idx ON execution.pr_context(created_at, id)
    WHERE status IN ('pending', 'collecting');
