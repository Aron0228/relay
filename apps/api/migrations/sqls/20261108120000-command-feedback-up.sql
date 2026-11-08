ALTER TABLE execution.task ADD COLUMN feedback_phase text NOT NULL DEFAULT 'progress'
    CHECK (feedback_phase IN ('progress', 'final'));
UPDATE execution.task SET feedback_phase = 'final' WHERE ended_at IS NOT NULL;

CREATE TABLE github.command_reply (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_comment_id bigint NOT NULL UNIQUE,
    repository_id uuid NOT NULL REFERENCES github.repository(id) ON DELETE CASCADE,
    number integer NOT NULL CHECK (number > 0),
    body text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    comment_id bigint,
    lease_token uuid,
    lease_expires_at timestamptz,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
