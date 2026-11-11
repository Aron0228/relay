CREATE SCHEMA knowledge;

CREATE TABLE knowledge.environment_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES auth.environment(id),
  scope_origin text NOT NULL,
  type text NOT NULL CHECK (type IN ('navigation', 'workflow', 'precondition', 'behavior')),
  title varchar(200) NOT NULL,
  content text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'retired')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_run_id uuid NOT NULL REFERENCES execution.run(id),
  source_event_ids jsonb NOT NULL,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX environment_knowledge_lookup ON knowledge.environment_knowledge(environment_id, scope_origin, verification_status);
CREATE UNIQUE INDEX environment_knowledge_title ON knowledge.environment_knowledge(environment_id, scope_origin, lower(title)) WHERE verification_status <> 'retired';

CREATE TABLE knowledge.knowledge_patch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES auth.environment(id),
  knowledge_id uuid REFERENCES knowledge.environment_knowledge(id),
  source_run_id uuid NOT NULL REFERENCES execution.run(id),
  request_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'verify', 'retire')),
  status text NOT NULL CHECK (status IN ('accepted', 'pending', 'conflict', 'rejected')),
  base_version integer,
  reason text NOT NULL,
  source_event_ids jsonb NOT NULL,
  proposal jsonb NOT NULL,
  decided_by uuid REFERENCES auth."user"(id),
  decided_at timestamptz,
  previous jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_run_id, request_id)
);

CREATE INDEX knowledge_patch_history ON knowledge.knowledge_patch(environment_id, knowledge_id, created_at);

CREATE TABLE knowledge.run_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES execution.run(id) ON DELETE CASCADE,
  knowledge_id uuid NOT NULL REFERENCES knowledge.environment_knowledge(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, knowledge_id, version)
);
