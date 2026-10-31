ALTER TABLE github.repository DROP COLUMN disconnected_at;
ALTER TABLE github.installation DROP COLUMN disconnected_at, DROP COLUMN connected_by;
