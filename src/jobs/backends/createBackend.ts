import type { JobQueueConfig } from "../../config/jobQueueConfig";
import { MemoryQueueBackend } from "./memoryBackend";
import { PostgresQueueBackend } from "./postgresBackend";
import type { QueueBackend } from "./types";

export function createQueueBackend(config: JobQueueConfig): QueueBackend {
  if (config.backend === "postgres") {
    if (!config.databaseUrl) {
      const message = "JOBS_BACKEND=postgres requires DATABASE_URL";
      if (process.env.NODE_ENV === "production") {
        throw new Error(message);
      }
      console.warn(`[jobs] ${message}; falling back to memory queue`);
      return new MemoryQueueBackend();
    }
    return new PostgresQueueBackend(config.databaseUrl);
  }
  if (config.backend === "redis") {
    console.warn("[jobs] Redis backend not configured; falling back to memory queue");
  }
  return new MemoryQueueBackend();
}
