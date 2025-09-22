-- Add analysis_id for separate analysis access
-- This provides security separation between survey responses and analysis

ALTER TABLE surveys ADD COLUMN analysis_id TEXT;

-- Create unique index for analysis_id
CREATE UNIQUE INDEX idx_surveys_analysis_id ON surveys(analysis_id);

-- For existing surveys, we'll need to populate analysis_id
-- This should be done manually or with a data migration script
-- UPDATE surveys SET analysis_id = 'some_new_ulid' WHERE analysis_id IS NULL;