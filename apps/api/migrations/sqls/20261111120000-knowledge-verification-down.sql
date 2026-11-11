DROP TABLE knowledge.run_patch;
ALTER TABLE knowledge.knowledge_patch DROP CONSTRAINT knowledge_patch_applied_verification_fk;
DROP TABLE knowledge.knowledge_verification;
ALTER TABLE knowledge.knowledge_patch
  DROP COLUMN source_environment_id,
  DROP COLUMN source_url,
  DROP COLUMN scope_origin,
  DROP COLUMN scope_path,
  DROP COLUMN source_pull_request_id,
  DROP COLUMN applied_verification_id;
ALTER TABLE knowledge.environment_knowledge DROP COLUMN scope_path;
