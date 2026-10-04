import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFieldHandlingEvidence } from "./fieldHandlingEvidence";
import { contentLooksLikeAskedFieldReject, verifiedFieldHandlingEvidence } from "./searchQuery";

const ask = "A client sent an assignee that isn’t on the team — the API returns an error. Where does the API reject a bad assignee_id?";
const captured = readFileSync(join(__dirname, "fixtures/plane-issue-validate-preview.py"), "utf8");
const method = captured.slice(captured.indexOf("    def validate"));
const numbered = method.split("\n").map((row, index) => `${75 + index}|${row}`).join("\n");
const file = { path: "apps/api/plane/api/serializers/issue.py", content: numbered, evidenceSource: "remote-read" };
const evidence = verifiedFieldHandlingEvidence(file, ask);
assert.ok(evidence, "captured remote validate method establishes filtering of the asked input");
assert.equal(evidence.kind, "filtered-input");
assert.equal(evidence.field, "assignees");
assert.equal(evidence.method, "validate");
assert.equal(evidence.startLine, 75);
assert.equal(evidence.endLine, 149);
const fullRemoteBody = Array.from({ length: 74 }, () => "# preceding source row").join("\n") + "\n" + method + "\n    def next_method(self):\n        pass";
const fullEvidence = verifiedFieldHandlingEvidence({ ...file, content: fullRemoteBody }, ask);
assert.equal(fullEvidence?.startLine, 75);
assert.equal(fullEvidence?.endLine, 149);
assert.equal(contentLooksLikeAskedFieldReject(numbered, ask, file.path), false, "alternative does not become a rejection");
for (const evidenceSource of [undefined, "search-snippet", "local", "indexed-snippet"]) {
  assert.equal(verifiedFieldHandlingEvidence({ ...file, evidenceSource }, ask), undefined, "explicit remote-read provenance is required");
}
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: '108|data["assignees"] = ProjectMember.objects.filter(member_id__in=data["assignees"]).values_list("member_id", flat=True)' }, ask), undefined, "snippet alone is insufficient");
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: numbered.replace(/149\|\s*return data/, "") }, ask), undefined, "incomplete method is insufficient");
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: numbered.replace('data["assignees"] =', 'eligible =') }, ask), undefined, "filtering without replacing input is insufficient");
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: numbered.replace('member_id__in=data["assignees"]', 'member_id__in=other_ids') }, ask), undefined, "the filter must consume the same input");
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: numbered.replace(/assignees/g, "watchers") }, ask), undefined, "unrelated field filtering is insufficient");
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: numbered.replace("def validate", "def get_queryset") }, ask), undefined, "read/query methods are insufficient");
for (const path of ["apps/api/plane/utils/issue_filters.py", "apps/web/issue.ts", "docs/issue.md", "apps/api/tests/issue.py"]) {
  assert.equal(verifiedFieldHandlingEvidence({ ...file, path }, ask), undefined, "query/UI/docs/tests cannot establish writer handling");
}
const withReject = numbered.replace("149|        return data", '149|        if data.get("assignees"):\n150|            raise serializers.ValidationError("Assignees are invalid")\n151|        return data');
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: withReject }, ask), undefined, "actual field rejection takes precedence");
assert.equal(classifyFieldHandlingEvidence({ ...file, content: withReject }, ["assignee", "assignee_id"]), undefined);
const labelAsk = "Where does the API reject a bad label_id?";
assert.equal(verifiedFieldHandlingEvidence(file, labelAsk)?.field, "labels", "filter handling is generic across fields");
const namelessReject = numbered.replace("149|        return data", '149|        if (\n150|            data.get("assignees")\n151|            and invalid_input\n152|        ):\n153|            raise serializers.ValidationError("Invalid input")\n154|        return data');
assert.equal(verifiedFieldHandlingEvidence({ ...file, content: namelessReject }, ask), undefined, "a multiline asked-field guard with nameless error still takes precedence");
const parentAsk = "Where does the API reject a bad parent issue_id?";
assert.equal(verifiedFieldHandlingEvidence(file, parentAsk), undefined, "real parent rejection remains classified separately");
console.log("verified field-handling evidence checks passed");
