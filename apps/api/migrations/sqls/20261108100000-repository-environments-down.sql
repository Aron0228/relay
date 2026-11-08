DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM auth.environment WHERE base_url IS NULL)
       OR EXISTS (SELECT 1 FROM github.repository WHERE default_environment_id IS NULL) THEN
        RAISE EXCEPTION 'Before rollback, configure a concrete base URL for every environment and a default environment for every repository.';
    END IF;
END $$;
ALTER TABLE auth.environment DROP CONSTRAINT environment_repository_fk;
DROP INDEX auth.environment_repository_idx;
ALTER TABLE auth.environment DROP COLUMN repository_id, DROP COLUMN allowed_origins, ALTER COLUMN base_url SET NOT NULL;
ALTER TABLE github.repository ALTER COLUMN default_environment_id SET NOT NULL;
