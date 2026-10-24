ALTER TABLE execution.run ADD COLUMN agent_input jsonb;

CREATE TABLE execution.run_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES execution.run(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'browser-test',
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'inconclusive')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
