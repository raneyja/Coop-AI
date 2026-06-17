-- Track embedding step separately from overall index_status so SCIP+Zoekt success
-- can be marked ready even when OpenAI embedding indexing fails (rate limits, etc.).

ALTER TABLE org_repos
  ADD COLUMN IF NOT EXISTS embedding_status VARCHAR(16),
  ADD COLUMN IF NOT EXISTS embedding_error TEXT;
