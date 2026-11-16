-- AI for bots: settings as JSON (endpoint, model, instructions, when to answer…) and the API key, kept
-- apart so it is never sent to anyone's browser.
ALTER TABLE bots ADD COLUMN ai TEXT;
ALTER TABLE bots ADD COLUMN ai_key TEXT;
