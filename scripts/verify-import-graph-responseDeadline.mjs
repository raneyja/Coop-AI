/**
 * Local gate: extract import edges from this repo and require real callers of
 * src/config/responseDeadline.ts (no Deep-Index / DB required).
 *
 * Terminal: node --import tsx scripts/verify-import-graph-responseDeadline.mjs
 * or: npx tsx scripts/verify-import-graph-responseDeadline.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractImportEdges } from "../src/indexing/importGraphExtractor.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = "src/config/responseDeadline.ts";
const required = ["src/chat/CoopChatSession.ts", "src/jobs/JobApiClient.ts"];

const edges = extractImportEdges(root);
const callers = edges
  .filter((edge) => edge.to === target || edge.to.endsWith(`/${target}`))
  .map((edge) => edge.from);

console.log(`edges=${edges.length} callers_of_${target}=${callers.length}`);
for (const caller of callers.slice(0, 20)) {
  console.log(`  ${caller}`);
}

const missing = required.filter((path) => !callers.includes(path));
if (missing.length) {
  console.error(`FAIL missing required callers: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("PASS import graph finds CoopChatSession + JobApiClient for responseDeadline");
