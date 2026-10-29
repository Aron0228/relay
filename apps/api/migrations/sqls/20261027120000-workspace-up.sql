ALTER TABLE auth."user" ADD COLUMN verified_emails jsonb NOT NULL DEFAULT '[]';

CREATE TABLE auth.workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  avatar_url text,
  created_by uuid NOT NULL REFERENCES auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE auth.workspace_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES auth.workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_member_user_idx ON auth.workspace_member(user_id);

CREATE TABLE auth.workspace_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES auth.workspace(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(trim(email))),
  invited_by uuid NOT NULL REFERENCES auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
CREATE INDEX workspace_invitation_email_idx ON auth.workspace_invitation(email);

CREATE TABLE auth.environment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES auth.workspace(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  base_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, workspace_id)
);
CREATE INDEX environment_workspace_idx ON auth.environment(workspace_id);

ALTER TABLE execution.run
  ADD COLUMN workspace_id uuid REFERENCES auth.workspace(id),
  ADD COLUMN environment_id uuid,
  ADD CONSTRAINT run_environment_workspace_fk FOREIGN KEY (environment_id, workspace_id)
    REFERENCES auth.environment(id, workspace_id),
  ADD CONSTRAINT run_workspace_environment_pair CHECK ((workspace_id IS NULL) = (environment_id IS NULL));
CREATE INDEX run_workspace_created_idx ON execution.run(workspace_id, created_at, id);
