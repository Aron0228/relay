ALTER TABLE execution.run DROP CONSTRAINT run_workspace_environment_pair,
  DROP CONSTRAINT run_environment_workspace_fk,
  DROP COLUMN environment_id, DROP COLUMN workspace_id;
DROP TABLE auth.environment;
DROP TABLE auth.workspace_invitation;
DROP TABLE auth.workspace_member;
DROP TABLE auth.workspace;
ALTER TABLE auth."user" DROP COLUMN verified_emails;
