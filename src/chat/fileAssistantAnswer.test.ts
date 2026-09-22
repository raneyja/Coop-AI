import assert from "node:assert/strict";
import { enrichFileAssistantResponse } from "./fileAssistantAnswer";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const L4_FAIL = `If you change the local file /Users/jonraney/Desktop/cody-vs-main/src/Cody.Core/Agent/SetHtmlEvent.cs, check every consumer and any serialized contracts that depend on these event types/properties — renaming a property is a breaking change. Also note the apparent typo Messsage on SetWebviewRequestEvent (likely intended Message) and treat it as a public API change: update callers, serializers, docs, and tests.

**Concrete spot to review**

\`\`\`
11:15:/Users/jonraney/Desktop/cody-vs-main/src/Cody.Core/Agent/SetHtmlEvent.cs
    public class SetWebviewRequestEvent : EventArgs
    {
        public string Handle { get; set; }
        public string Messsage { get; set; }
    }
\`\`\`

**Quick checklist (what to search & update)**

- Search the codebase for the types SetHtmlEvent, SetWebviewRequestEvent, and AgentResponseEvent and update all call sites.
- If you rename Messsage → Message: update every usage, JSON attributes, and tests.

**Risks & small improvements**

- Risk: Renaming public properties breaks binary/serialized compatibility.

If you want, I can produce the exact code patch to rename Messsage to Message with an [Obsolete] compatibility shim — tell me whether you prefer a breaking rename or compatibility-preserving change.`;

test("L4 secrets-style Fail is cut to the lead plus an honest limit", () => {
  const trimmed = enrichFileAssistantResponse(L4_FAIL);
  assert.match(trimmed, /SetHtmlEvent\.cs/);
  assert.match(trimmed, /Messsage/);
  assert.match(trimmed, /Other files were not read/);
  assert.doesNotMatch(trimmed, /Concrete spot to review|Quick checklist|Risks & small improvements/i);
  assert.doesNotMatch(trimmed, /Search the codebase|If you want, I can produce/i);
  assert.doesNotMatch(trimmed, /NuGet|JsonPropertyName|release notes/i);
});

test("a paraphrase of the honest limit is not followed by a second copy", () => {
  const lead =
    "I added a one-line comment above the constructor in the local file /Users/me/Desktop/sample/Widget.cs.";
  const paraphrase =
    "I only read this local file; callers and implementations of imported types were not examined.";
  const once = enrichFileAssistantResponse(`${lead}\n\n${paraphrase}`);
  assert.match(once, /only read this local file/);
  assert.doesNotMatch(once, /Other files were not read/);
  const both = enrichFileAssistantResponse(
    `${lead}\n\n${paraphrase}\n\nOther files were not read, so callers and implementations of imported types are unknown.`
  );
  assert.match(both, /Other files were not read/);
  assert.doesNotMatch(both, /only read this local file/);
  assert.equal(both.split(/\n\n+/).filter((part) => /not read|only read this/i.test(part)).length, 1);
  const sameParagraph = enrichFileAssistantResponse(`${lead} ${paraphrase} Other files were not read, so callers and implementations of imported types are unknown.`);
  assert.match(sameParagraph, /Other files were not read/);
  assert.doesNotMatch(sameParagraph, /only read this local file/);
});

test("already-short L answer keeps its honest limit and is not rewritten", () => {
  const pass =
    "The local file /Users/me/Desktop/sample/Widget.cs wires three callbacks. Other files were not read, so callers and implementations of imported types are unknown.";
  assert.equal(enrichFileAssistantResponse(pass), pass);
});

test("empty content is left alone", () => {
  assert.equal(enrichFileAssistantResponse(""), "");
  assert.equal(enrichFileAssistantResponse("   "), "   ");
});

async function main(): Promise<void> {
  const total = passed + failed;
  console.log(`\nfileAssistantAnswer: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
