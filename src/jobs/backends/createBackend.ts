import type { JobQueueConfig } from "../../config/jobQueueConfig";
import { MemoryQueueBackend } from "./memoryBackend";
import { PostgresQueueBackend } from "./postgresBackend";
import type { QueueBackend } from "./types";

export function createQueueBackend(config: JobQueueConfig): QueueBackend {
  if (config.backend === "postgres" && config.databaseUrl) {
    return new PostgresQueueBackend(config.databaseUrl);
  }
  if (config.backend === "redis") {
    console.warn("[jobs] Redis backend not configured; falling back to memory queue");
  }
  return new MemoryQueueBackend();
}
