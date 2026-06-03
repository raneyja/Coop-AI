-- Pro Lightning Mode semantic fallback (pgvector embeddings for files without SCIP coverage)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS repo_embeddings (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  file_path TEXT NOT NULL,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id, file_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_repo_embeddings_repo ON repo_embeddings (org_id, repo_id);

CREATE INDEX IF NOT EXISTS idx_repo_embeddings_vector ON repo_embeddings
  USING hnsw (embedding vector_cosine_ops);
