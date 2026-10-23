-- One link per Elastic account (October 2026): tokens of scope `elastic-link` are held by
-- Elastic's Worker and used over a service binding. `ext` is the Elastic account they belong
-- to, so Boardo can tell Elastic whose cards changed.
ALTER TABLE app_tokens ADD COLUMN ext TEXT;
CREATE INDEX app_tokens_ext ON app_tokens (ext);
