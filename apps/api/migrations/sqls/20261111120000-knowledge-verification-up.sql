ALTER TABLE knowledge.environment_knowledge ADD COLUMN scope_path text NOT NULL DEFAULT '/';

ALTER TABLE knowledge.knowledge_patch
  ADD COLUMN source_environment_id uuid REFERENCES auth.environment(id),
  ADD COLUMN source_url text,
  ADD COLUMN scope_origin text,
  ADD COLUMN scope_path text NOT NULL DEFAULT '/',
  ADD COLUMN source_pull_request_id uuid REFERENCES github.pull_request(id),
  ADD COLUMN applied_verification_id uuid;

UPDATE knowledge.knowledge_patch p SET
  source_environment_id = r.environment_id,
  source_url = r.agent_input->>'targetUrl',
  scope_origin = COALESCE((SELECT scope_origin FROM knowledge.environment_knowledge WHERE id = p.knowledge_id), (SELECT substring(base_url from '^https?://[^/]+') FROM auth.environment WHERE id = p.environment_id), substring(r.agent_input->>'targetUrl' from '^https?://[^/]+')),
  source_pull_request_id = t.pull_request_id
FROM execution.run r
LEFT JOIN execution.task t ON t.id = r.task_id
WHERE p.source_run_id = r.id;

UPDATE knowledge.environment_knowledge k SET scope_path = COALESCE((
  SELECT COALESCE(NULLIF(rtrim(substring(e.payload->>'observation' from '^URL: https?://[^/[:space:]]+([^[:space:]?#]*)'), '/'), ''), '/')
  FROM execution.run_event e WHERE e.id = (k.source_event_ids->>0)::uuid
), '/');

UPDATE knowledge.knowledge_patch p SET scope_path = COALESCE((
  SELECT COALESCE(NULLIF(rtrim(substring(e.payload->>'observation' from '^URL: https?://[^/[:space:]]+([^[:space:]?#]*)'), '/'), ''), '/')
  FROM execution.run_event e WHERE e.id = (p.source_event_ids->>0)::uuid
), '/');

CREATE TABLE knowledge.knowledge_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial NOT NULL UNIQUE,
  patch_id uuid NOT NULL REFERENCES knowledge.knowledge_patch(id),
  knowledge_id uuid REFERENCES knowledge.environment_knowledge(id),
  run_id uuid NOT NULL REFERENCES execution.run(id),
  request_id uuid NOT NULL,
  base_version integer,
  result text NOT NULL CHECK (result IN ('confirmed', 'contradicted', 'inconclusive')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason text NOT NULL,
  source_event_ids jsonb NOT NULL,
  observed_urls jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, request_id)
);

ALTER TABLE knowledge.knowledge_patch ADD CONSTRAINT knowledge_patch_applied_verification_fk
  FOREIGN KEY (applied_verification_id) REFERENCES knowledge.knowledge_verification(id);

CREATE INDEX knowledge_verification_history ON knowledge.knowledge_verification(patch_id, sequence DESC);
CREATE INDEX knowledge_verification_run ON knowledge.knowledge_verification(run_id);
CREATE INDEX knowledge_patch_relevance ON knowledge.knowledge_patch(environment_id, scope_origin, scope_path) WHERE status = 'pending';

CREATE TABLE knowledge.run_patch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES execution.run(id) ON DELETE CASCADE,
  patch_id uuid NOT NULL REFERENCES knowledge.knowledge_patch(id),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, patch_id)
);
