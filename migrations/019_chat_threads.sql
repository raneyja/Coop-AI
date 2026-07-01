CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  principal TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  repo_owner TEXT,
  repo_name TEXT,
  repo_provider TEXT,
  message_count INT NOT NULL DEFAULT 0,
  preview_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_threads_org_updated ON chat_threads(org_id, updated_at DESC);
CREATE INDEX chat_threads_org_user ON chat_threads(org_id, user_id);
CREATE INDEX chat_threads_org_repo ON chat_threads(org_id, repo_owner, repo_name);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX chat_messages_thread ON chat_messages(thread_id, sort_order);
