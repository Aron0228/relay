ALTER TABLE github.installation
    ADD COLUMN connected_by uuid REFERENCES auth."user"(id),
    ADD COLUMN disconnected_at timestamptz;
ALTER TABLE github.repository ADD COLUMN disconnected_at timestamptz;
