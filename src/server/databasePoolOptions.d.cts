import type { PoolConfig } from "pg";
declare function databasePoolOptions(connectionString: string, env?: NodeJS.ProcessEnv): PoolConfig;
export = databasePoolOptions;
