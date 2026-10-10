import assert from "node:assert/strict";
import {
  gatherUnderstandSourceEvidence, understandFocusCoverage, understandIncompleteFocusMessage,
  understandSourceWindows, understandFocusQueries
} from "./understandRepoSourceEvidence";
import { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import type { RepoInventoryDeps } from "../workspace/repoInventorySources";
import { buildUserMessageWithContext } from "../prompts/systemPrompts";
import { repoSummaryFromBundle } from "./contextBundleEvidence";
import { isolateUnderstandRepoSummary } from "./understandRepoDomainAttach";
import { shouldEnableSynthesisThinking } from "../config/chatSynthesisThinking";
import { enrichUnderstandRepoResponse } from "../prompts/repoSummaryResponseEnrichment";

const ask = "If I’m joining the Plane backend team to work on issue creation, which components handle request authentication, input validation, and persistence, and which three files should I read first?";
const target = { repoId: "github:org/service", owner: "org", repo: "service", provider: "github", branch: "preview" };
const padding = Array.from({length: 450}, (_, i) => `# unrelated line ${i} with enough bytes to exceed the old prefix cap`).join("\n");
const source: Record<string, string> = {
  "apps/api/service/api/views/issue.py": `from service.api.views.base import BaseAPIView\n${padding}\nclass IssueCreate(BaseAPIView):\n    def post(self, request):\n        serializer = IssueSerializer(data=request.data)\n        if serializer.is_valid():\n            serializer.save()`,
  "apps/api/service/api/serializers/issue.py": `class IssueSerializer:\n    def validate(self, data):\n        if not data.get('state'):\n            raise ValidationError('state required')\n        return data\n    def create(self, data):\n        return Issue.objects.create(**data)`,
  "apps/api/service/db/models/issue.py": `class Issue:\n    def save(self):\n        super(Issue, self).save()`,
  "apps/api/service/api/views/base.py": `class BaseAPIView:\n    authentication_classes = [APIKeyAuthentication]\n    permission_classes = [IsAuthenticated]`,
  "apps/api/service/api/middleware/api_authentication.py": `class APIKeyAuthentication:\n    def authenticate(self, request):\n        token = request.headers.get('X-Api-Key')\n        if not token:\n            raise AuthenticationFailed('required')\n        return user, token`,
  "apps/api/service/app/serializers/issue.py": `class OtherSerializer: pass`,
  "apps/web/components/issue.ts": `function createIssue() { return db.issue.create({}); }`
};

async function main(): Promise<void> {
  const queries = understandFocusQueries(ask)!;
  assert.deepEqual(queries, ["issue", "authentication", "serializer", "model"]);
  assert.ok(!queries.some(query => /joining|Plane|three/.test(query)));
  const failedFiles = [
    {path: "apps/api/service/api/urls/intake.py", content: 'path("issues/", IssueView.as_view())'},
    {path: "apps/api/service/space/urls/issue.py", content: 'path("issues/", PublicIssueView.as_view())'},
    {path: "apps/web/profile/form.ts", content: 'validate(); db.issue.create({});'},
    {path: "apps/admin/authentication/page.ts", content: 'authentication settings'},
    {path: "packages/utils/src/validation.ts", content: 'const validate = (input) => input;'}
  ];
  const missing = understandFocusCoverage(ask, failedFiles);
  assert.deepEqual(missing.missing, missing.requested);
  assert.ok(understandIncompleteFocusMessage(missing)?.includes("unverified"));
  assert.ok(!understandIncompleteFocusMessage(missing)?.includes("typical"));
  console.log("✓ exact failed anchors cannot establish the backend components");

  const calls: Array<{path: string; branch?: string}> = [];
  const diagnostics: Record<string, unknown>[] = [];
  const deps = {
    apiBaseUrl: "https://api.coop-ai.dev",
    api: {
      fetchIndexedRepoFileMap: async () => ({repoId: target.repoId, indexedBranch: target.branch,
        indexedCommit: "commit", stale: false, data: Object.keys(source).map(path => ({path}))}),
      getBackendClient: () => ({fetchRepoFile: async (_url: string, repoId: string, path: string, branch: string) => {
        assert.equal(repoId, target.repoId); calls.push({path, branch}); return {path, content: source[path]};
      }})
    },
    codeHostRouter: {searchRepositoryFiles: async () => []}
  } as unknown as RepoInventoryDeps;
  const result = await gatherUnderstandSourceEvidence({workspace: new IndexedRepoWorkspace(deps), target,
    focus: ask, deadlineAt: Date.now() + 1000, onDiagnostic: event => diagnostics.push(event)});
  const isolated = isolateUnderstandRepoSummary({ ...result, userFocus: ask,
    treeOverview: {topLevelDirs: ["apps", "packages"]} });
  assert.ok(isolated.entryFiles.some(file => file.content.includes("def post(")), "late request implementation survives source selection");
  assert.ok(isolated.entryFiles.some(file => file.path.endsWith("api/views/base.py")), "read actual imported authentication binding");
  assert.ok(!calls.some(call => call.path.includes("apps/web") || call.path.includes("app/serializers")));
  assert.ok(calls.every(call => call.branch === "preview"));
  const coverage = understandFocusCoverage(ask, isolated.entryFiles);
  assert.deepEqual(coverage.missing, []);
  assert.equal(understandIncompleteFocusMessage(coverage), undefined);
  const bundle = [{type: "file_metadata", data: {...isolated, focusCoverage: coverage}}];
  assert.deepEqual(repoSummaryFromBundle(bundle)?.focusCoverage, coverage);
  const message = buildUserMessageWithContext(ask, { owner: "org", repo: "service", branch: "preview", contextBundle: bundle });
  const late = isolated.entryFiles.find(file => file.content.includes("def post("))!;
  assert.ok(message.includes(`lines="${late.startLine}-${late.endLine}" truncated="true"`));
  assert.ok(message.includes("def post("));
  assert.ok(message.includes(`${late.startLine} | `), "source rows carry original numeric offsets");
  assert.equal(shouldEnableSynthesisThinking({quickAction: "understand-repo", startedAt: Date.now(), sourceFacts: isolated}), false);
  console.log("✓ canonical remote discovery → late source windows → coverage → serialized citations");
  const exactLines = late.content.split("\n");
  const index = exactLines.findIndex(line => line.includes("def post("));
  const actualLine = late.startLine! + index;
  const exact = exactLines.slice(index, index + 3).join("\n");
  const summary = {...isolated, focusCoverage: coverage};
  assert.ok(enrichUnderstandRepoResponse(`Flow\n\n\`\`\`1:3:${late.path}\n${exact}\n\`\`\``, summary).includes(`\`\`\`${actualLine}:${actualLine + 2}:${late.path}`), "verbatim code gets its real coordinates");
  assert.ok(!enrichUnderstandRepoResponse(`Flow\n\n\`\`\`104:149:${late.path}\n${exact}\n...\ninvented.save()\n\`\`\``, summary).includes("invented.save"), "unverified code/ranges do not survive the finish gate");
  assert.equal(enrichUnderstandRepoResponse("Speculative implementation essay", {...summary, entryFiles: failedFiles}), understandIncompleteFocusMessage(missing));
  console.log("✓ finish gate replaces unsupported reports and removes unverified citation ranges");

  const withoutAuthImplementation = isolated.entryFiles.filter(file => !file.path.includes("middleware"));
  assert.ok(understandFocusCoverage(ask, withoutAuthImplementation).missing.includes("authentication"), "a binding alone does not prove imported authentication");
  const wrongAuthentication = isolated.entryFiles.map(file => file.path.includes("middleware")
    ? {...file, content: file.content.replace(/APIKeyAuthentication/g, "UnrelatedAuthentication")} : file);
  assert.ok(understandFocusCoverage(ask, wrongAuthentication).missing.includes("authentication"), "an unrelated auth implementation does not satisfy the binding");
  const noWriter = isolated.entryFiles.filter(file => !/serializers|models/.test(file.path));
  assert.ok(understandFocusCoverage(ask, noWriter).missing.includes("persistence"), "serializer.save alone does not establish persistence");
  const unrelated = [...noWriter, {path: "apps/api/service/validators/random.py",
    content: "class UnrelatedValidator:\n    def validate(self, data):\n        return Other.objects.create(**data)"}];
  assert.ok(understandFocusCoverage(ask, unrelated).missing.includes("input validation"));
  assert.ok(understandFocusCoverage(ask, unrelated).missing.includes("persistence"), "unrelated backend bodies cannot fill the flow's obligations");
  console.log("✓ unresolved authentication and persistence bodies remain coverage limits");

  const slowWorkspace = {
    findFiles: async (_target: unknown, query: string) => {
      if (query === "authentication") await new Promise(resolve => setTimeout(resolve, 100));
      return Object.keys(source).filter(path => path.includes(query)).map(path => ({path, name: path.split('/').pop()!}));
    },
    readFile: async (_target: unknown, path: string) => ({path, repoId: target.repoId, origin: "remote" as const, content: source[path]})
  };
  const partial = await gatherUnderstandSourceEvidence({workspace: slowWorkspace, target, focus: ask, deadlineAt: Date.now() + 30});
  assert.ok(partial.entryFiles.some(file => file.content.includes("def post(")), "slow auth search does not discard completed domain reads");
  const snapshot = JSON.stringify(partial);
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(JSON.stringify(partial), snapshot, "late completions cannot mutate delivered evidence");
  assert.ok(understandFocusCoverage(ask, partial.entryFiles).missing.includes("authentication"));
  console.log("✓ partial evidence survives a slow sibling and cannot mutate after deadline");
  const stop = new AbortController();
  let stopReads = 0;
  const stopped = gatherUnderstandSourceEvidence({workspace: {
    findFiles: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return [{path: Object.keys(source)[0], name: "issue.py"}]; },
    readFile: slowWorkspace.readFile
  }, target, focus: ask, deadlineAt: Date.now() + 1000, signal: stop.signal, onRead: () => stopReads++});
  stop.abort();
  assert.equal((await stopped).entryFiles.length, 0);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(stopReads, 0, "Stop prevents late discovery from scheduling reads");
  console.log("✓ user Stop freezes the gather and prevents later source reads");

  const rejected = await gatherUnderstandSourceEvidence({workspace: {findFiles: slowWorkspace.findFiles,
    readFile: async (_target, path) => ({path, repoId: "github:other/repo", origin: "remote", content: source[path]})},
    target, focus: ask, deadlineAt: Date.now() + 200});
  assert.equal(rejected.entryFiles.length, 0, "foreign bodies rejected");
  const windows = understandSourceWindows({path: 'src/serializer.py', content: padding + '\n    def validate(self, data):\n        raise ValidationError("bad")\n    def create(self, data):\n        return Record.objects.create(**data)'});
  for (const window of windows) assert.equal(window.content, (padding + '\n    def validate(self, data):\n        raise ValidationError("bad")\n    def create(self, data):\n        return Record.objects.create(**data)').split('\n').slice(window.startLine! - 1, window.endLine).join('\n'));
  console.log("✓ foreign evidence rejected and numeric ranges match original source");
}
void main();
