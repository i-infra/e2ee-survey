-- Initial database schema for encrypted survey tool

CREATE TABLE surveys (
    id TEXT PRIMARY KEY,           -- ULID for survey
    title TEXT NOT NULL,           -- Encrypted survey title
    description TEXT,              -- Encrypted survey description  
    questions BLOB NOT NULL,       -- Encrypted questions JSON
    salt BLOB NOT NULL,            -- 16-byte salt for key derivation
    created_at INTEGER NOT NULL,   -- Unix timestamp
    expires_at INTEGER,            -- Optional expiration timestamp
    max_responses INTEGER,         -- Optional response limit
    creator_key_hash TEXT NOT NULL -- Hash of creator's key for verification
);

CREATE TABLE responses (
    id TEXT PRIMARY KEY,           -- ULID for response
    survey_id TEXT NOT NULL,       -- Reference to survey
    answers BLOB NOT NULL,         -- Encrypted answers JSON
    submitted_at INTEGER NOT NULL, -- Unix timestamp
    FOREIGN KEY (survey_id) REFERENCES surveys(id)
);

-- Indexes for performance
CREATE INDEX idx_surveys_created_at ON surveys(created_at);
CREATE INDEX idx_responses_survey_id ON responses(survey_id);
CREATE INDEX idx_responses_submitted_at ON responses(submitted_at);