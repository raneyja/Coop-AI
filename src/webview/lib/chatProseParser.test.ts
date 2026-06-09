import assert from "node:assert/strict";
import { parseChatProse } from "./chatProseParser";

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

// ── Test 1: Simple paragraph ───────────────────────────────────────────────
test("simple paragraph", () => {
  const doc = parseChatProse("Hello world");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    assert.equal(block.content.length, 1);
    assert.deepEqual(block.content[0], { type: "text", text: "Hello world" });
  }
});

// ── Test 2: Multiple paragraphs ────────────────────────────────────────────
test("multiple paragraphs separated by blank line", () => {
  const doc = parseChatProse("First paragraph.\n\nSecond paragraph.");
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0]!.type, "paragraph");
  assert.equal(doc.blocks[1]!.type, "paragraph");
  if (doc.blocks[1]!.type === "paragraph") {
    const node = doc.blocks[1].content[0]!;
    assert.equal(node.type, "text");
    if (node.type === "text") {
      assert.ok(node.text.includes("Second paragraph"));
    }
  }
});

// ── Test 3: Section heading ────────────────────────────────────────────────
test("**What changed** on its own line is a section-heading", () => {
  const doc = parseChatProse("**What changed**");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "section-heading");
  if (block.type === "section-heading") {
    assert.equal(block.text, "What changed");
  }
});

// ── Test 4: Heading with period → paragraph ────────────────────────────────
test("**Sentence ending with period.** is a paragraph, not section-heading", () => {
  const doc = parseChatProse("**This ends with a period.**");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]!.type, "paragraph");
});

test("**Open question:** alone is a paragraph, not section-heading", () => {
  const doc = parseChatProse("**Open question:**");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]!.type, "paragraph");
});

test("flat knowledge-gap list promotes categories to subheadings with renamed field labels", () => {
  const content = [
    "**Key Unknowns in `src/server/githubAppApi.ts`**",
    "",
    "- **Error Handling Specifics**",
    "- **Question:** How should different types of errors be handled?",
    "- **Evidence Needed:** Documentation on error handling practices.",
    "- **Dependencies Configuration**",
    "- **Question:** What configurations are required for GitHubAppService?",
    "- **Evidence Needed:** Setup examples for these dependencies."
  ].join("\n");
  const doc = parseChatProse(content);
  const headings = doc.blocks.filter((b) => b.type === "section-heading");
  const subheadings = headings.filter(
    (b) => b.type === "section-heading" && b.headingLevel === 2
  );
  assert.equal(subheadings.length, 2);
  const lists = doc.blocks.filter((b) => b.type === "list");
  assert.equal(lists.length, 2);
  if (lists[0]?.type === "list") {
    assert.equal(lists[0].items.length, 2);
    const firstLabel = lists[0].items[0]!.content[0];
    assert.equal(firstLabel?.type, "strong");
    if (firstLabel?.type === "strong") {
      assert.equal(firstLabel.text, "Open question:");
    }
    const secondLabel = lists[0].items[1]!.content[0];
    if (secondLabel?.type === "strong") {
      assert.equal(secondLabel.text, "What to check:");
    }
  }
  const subheadingTexts = subheadings
    .filter((b): b is Extract<typeof b, { type: "section-heading" }> => b.type === "section-heading")
    .map((b) => b.text);
  assert.ok(subheadingTexts.includes("Error Handling Specifics"));
  assert.ok(subheadingTexts.includes("Dependencies Configuration"));
});

test("plain category lines normalize to headings with open question bullets", () => {
  const content = [
    "Dependency Configuration",
    "Question: Are the dependencies always provided?",
    "Evidence Needed: Documentation for dependency initialization.",
    "",
    "Authorization Logic",
    "Question: What defines a valid AuthContext?",
    "Evidence Needed: Definition of AuthContext from orgStore."
  ].join("\n");
  const doc = parseChatProse(content);
  const headings = doc.blocks.filter((b) => b.type === "section-heading");
  assert.equal(headings.length, 2);
  const lists = doc.blocks.filter((b) => b.type === "list");
  assert.equal(lists.length, 2);
});

test("answer lead remaps to summary with documentation gaps wrapper", () => {
  const content = [
    "**Answer**",
    "The code has gaps.",
    "",
    "Documentation coverage",
    "Open question: Is there sufficient documentation?",
    "What to check: Review comments and Confluence pages."
  ].join("\n");
  const doc = parseChatProse(content);
  const headings = doc.blocks.filter((b) => b.type === "section-heading");
  assert.ok(headings.some((h) => h.type === "section-heading" && h.text === "Summary"));
  assert.ok(headings.some((h) => h.type === "section-heading" && h.text === "Documentation gaps"));
  assert.ok(headings.some((h) => h.type === "section-heading" && h.text === "Documentation coverage"));
  const lists = doc.blocks.filter((b) => b.type === "list");
  assert.equal(lists.length, 1);
  if (lists[0]?.type === "list") {
    assert.equal(lists[0].items.length, 2);
  }
});

test("open questions layout promotes categories to subheadings with field bullets", () => {
  const content = [
    "The key unknowns in the code area primarily revolve around dependencies.",
    "",
    "Open Questions",
    "",
    "Dependency Configuration",
    "What specific configurations are required for GitHubAppService?",
    "What to check: Documentation or comments detailing required environment variables.",
    "",
    "Error Handling",
    "How should the system respond to specific error conditions?",
    "What to check: Specifications outlining expected behaviors for error scenarios."
  ].join("\n");
  const doc = parseChatProse(content);
  const headings = doc.blocks.filter((b) => b.type === "section-heading");
  const main = headings.filter((b) => b.type === "section-heading" && b.headingLevel === 1);
  const sub = headings.filter((b) => b.type === "section-heading" && b.headingLevel === 2);
  assert.equal(main.length, 1);
  if (main[0]?.type === "section-heading") {
    assert.equal(main[0].text, "Open Questions");
  }
  assert.equal(sub.length, 2);
  const lists = doc.blocks.filter((b) => b.type === "list");
  assert.equal(lists.length, 2);
  if (lists[0]?.type === "list") {
    assert.equal(lists[0].items.length, 2);
    const first = lists[0].items[0]!.content[0];
    if (first?.type === "strong") {
      assert.equal(first.text, "Open question:");
    }
    const second = lists[0].items[1]!.content[0];
    if (second?.type === "strong") {
      assert.equal(second.text, "What to check:");
    }
  }
});

test("grouped knowledge-gap prose uses subsection headings", () => {
  const content = [
    "**Summary**",
    "Two documentation gaps remain for the install flow.",
    "",
    "**Documentation gaps**",
    "",
    "**GitHub App install flow**",
    "",
    "- **Open question:** Who may complete installation?",
    "- **What to check:** Confluence runbook for install admins."
  ].join("\n");
  const doc = parseChatProse(content);
  const headings = doc.blocks.filter((b) => b.type === "section-heading");
  assert.equal(headings.length, 3);
  if (headings[0]?.type === "section-heading") {
    assert.equal(headings[0].text, "Summary");
  }
  if (headings[2]?.type === "section-heading") {
    assert.equal(headings[2].text, "GitHub App install flow");
  }
});

// ── Test 5: Unordered list ─────────────────────────────────────────────────
test("unordered list with dash marker", () => {
  const doc = parseChatProse("- alpha\n- beta\n- gamma");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "list");
  if (block.type === "list") {
    assert.equal(block.items.length, 3);
    assert.equal(block.items[0]!.marker, "-");
    assert.equal(block.items[1]!.marker, "-");
    const firstText = block.items[0]!.content[0]!;
    assert.equal(firstText.type, "text");
    if (firstText.type === "text") {
      assert.equal(firstText.text, "alpha");
    }
  }
});

// ── Test 6: Ordered list ───────────────────────────────────────────────────
test("ordered list items", () => {
  const doc = parseChatProse("1. First\n2. Second\n3. Third");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "list");
  if (block.type === "list") {
    assert.equal(block.items.length, 3);
    assert.equal(block.items[0]!.marker, "ordered");
    assert.equal(block.items[0]!.order, 1);
    assert.equal(block.items[1]!.order, 2);
    assert.equal(block.items[2]!.order, 3);
  }
});

// ── Test 7: Inline code ────────────────────────────────────────────────────
test("inline code renders as inline-code node", () => {
  const doc = parseChatProse("Use `foo` here.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const codeNode = block.content.find(n => n.type === "inline-code");
    assert.ok(codeNode, "expected inline-code node");
    if (codeNode && codeNode.type === "inline-code") {
      assert.equal(codeNode.code, "foo");
    }
  }
});

// ── Test 8: File link (no line number) ────────────────────────────────────
test("backtick file path becomes a file-link node", () => {
  const doc = parseChatProse("See `src/api/chat.ts` for details.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const linkNode = block.content.find(n => n.type === "file-link");
    assert.ok(linkNode, "expected file-link node");
    if (linkNode && linkNode.type === "file-link") {
      assert.equal(linkNode.path, "src/api/chat.ts");
      assert.equal(linkNode.line, undefined);
    }
  }
});

// ── Test 9: File link with line number ────────────────────────────────────
test("backtick file path with :line becomes a file-link with line", () => {
  const doc = parseChatProse("Check `src/api/chat.ts:42`.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const linkNode = block.content.find(n => n.type === "file-link");
    assert.ok(linkNode, "expected file-link node");
    if (linkNode && linkNode.type === "file-link") {
      assert.equal(linkNode.path, "src/api/chat.ts");
      assert.equal(linkNode.line, 42);
      assert.equal(linkNode.label, "src/api/chat.ts:42");
    }
  }
});

// ── Test 10: Bold inline ───────────────────────────────────────────────────
test("*term* inline renders as em node", () => {
  const doc = parseChatProse("This is *inferred from commit history* only.");
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const emNode = block.content.find((n) => n.type === "em");
    assert.ok(emNode, "expected em node");
    if (emNode && emNode.type === "em") {
      assert.equal(emNode.text, "inferred from commit history");
    }
  }
});

test("**term** inline renders as strong node", () => {
  const doc = parseChatProse("This is **important** text.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const strongNode = block.content.find(n => n.type === "strong");
    assert.ok(strongNode, "expected strong node");
    if (strongNode && strongNode.type === "strong") {
      assert.equal(strongNode.text, "important");
    }
  }
});

// ── Test 11: External link (markdown syntax) ──────────────────────────────
test("[label](url) renders as external-link with label and url", () => {
  const doc = parseChatProse("Visit [Pricing](https://coop-ai.dev/pricing) now.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const linkNode = block.content.find(n => n.type === "external-link");
    assert.ok(linkNode, "expected external-link node");
    if (linkNode && linkNode.type === "external-link") {
      assert.equal(linkNode.label, "Pricing");
      assert.equal(linkNode.url, "https://coop-ai.dev/pricing");
    }
  }
});

// ── Test 12: Bare URL ─────────────────────────────────────────────────────
test("bare URL becomes external-link with hostname as label", () => {
  const doc = parseChatProse("Go to https://coop-ai.dev today.");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "paragraph");
  if (block.type === "paragraph") {
    const linkNode = block.content.find(n => n.type === "external-link");
    assert.ok(linkNode, "expected external-link node");
    if (linkNode && linkNode.type === "external-link") {
      assert.equal(linkNode.url, "https://coop-ai.dev");
      assert.equal(linkNode.label, "coop-ai.dev");
    }
  }
});

// ── Test 13: Code fence with language ─────────────────────────────────────
test("code fence with language tag yields code-fence block", () => {
  const input = "```typescript\nconst x = 1;\n```";
  const doc = parseChatProse(input);
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "code-fence");
  if (block.type === "code-fence") {
    assert.equal(block.language, "typescript");
    assert.ok(block.code.includes("const x = 1;"));
  }
});

// ── Test 14: Code fence without language ──────────────────────────────────
test("code fence without language tag has undefined language", () => {
  const input = "```\nsome code\n```";
  const doc = parseChatProse(input);
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "code-fence");
  if (block.type === "code-fence") {
    assert.equal(block.language, undefined);
    assert.ok(block.code.includes("some code"));
  }
});

// ── Test 15: Citation fence ────────────────────────────────────────────────
test("citation fence with startLine:endLine:path yields code-citation", () => {
  const input = "```\n46:51:src/webview/ChatPanel.tsx\ncode here\n```";
  const doc = parseChatProse(input);
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "code-citation");
  if (block.type === "code-citation") {
    assert.equal(block.startLine, 46);
    assert.equal(block.endLine, 51);
    assert.equal(block.path, "src/webview/ChatPanel.tsx");
    assert.equal(block.code, "code here");
  }
});

// ── Test 16: Mixed content ────────────────────────────────────────────────
test("mixed: section-heading + paragraph + list + code fence", () => {
  const input = [
    "**Summary**",
    "",
    "Here is the change.",
    "",
    "- item one",
    "- item two",
    "",
    "```python",
    "print('hello')",
    "```"
  ].join("\n");

  const doc = parseChatProse(input);
  assert.equal(doc.blocks.length, 4);
  assert.equal(doc.blocks[0]!.type, "section-heading");
  assert.equal(doc.blocks[1]!.type, "paragraph");
  assert.equal(doc.blocks[2]!.type, "list");
  assert.equal(doc.blocks[3]!.type, "code-fence");

  const heading = doc.blocks[0]!;
  if (heading.type === "section-heading") {
    assert.equal(heading.text, "Summary");
  }

  const list = doc.blocks[2]!;
  if (list.type === "list") {
    assert.equal(list.items.length, 2);
  }

  const fence = doc.blocks[3]!;
  if (fence.type === "code-fence") {
    assert.equal(fence.language, "python");
  }
});

// ── Test 17: ### markdown header → section-heading with hash stripped ───────
test("### markdown header becomes section-heading with hash stripped", () => {
  const doc = parseChatProse("### Some Markdown Header");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]!.type, "section-heading");
  if (doc.blocks[0]!.type === "section-heading") {
    assert.equal(doc.blocks[0].text, "Some Markdown Header");
  }
});

test("### numbered section heading strips hash prefix", () => {
  const doc = parseChatProse("### 3. Operational Risks");
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0]!.type, "section-heading");
  if (doc.blocks[0]!.type === "section-heading") {
    assert.equal(doc.blocks[0].text, "3. Operational Risks");
  }
});

// ── Test 18: Empty string → empty blocks ──────────────────────────────────
test("empty string produces empty blocks array", () => {
  const doc = parseChatProse("");
  assert.deepEqual(doc.blocks, []);
});

// ── Test 19: Whitespace-only string → empty blocks ────────────────────────
test("whitespace-only string produces empty blocks", () => {
  const doc = parseChatProse("   \n\n   \n");
  assert.deepEqual(doc.blocks, []);
});

// ── Test 20: CRLF line endings normalized ────────────────────────────────
test("CRLF line endings normalize correctly", () => {
  const doc = parseChatProse("**Changes**\r\n\r\nSome text.");
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0]!.type, "section-heading");
  assert.equal(doc.blocks[1]!.type, "paragraph");
});

// ── Test 21: Asterisk list marker ────────────────────────────────────────
test("* list marker yields items with marker '*'", () => {
  const doc = parseChatProse("* one\n* two");
  assert.equal(doc.blocks.length, 1);
  const block = doc.blocks[0]!;
  assert.equal(block.type, "list");
  if (block.type === "list") {
    assert.equal(block.items[0]!.marker, "*");
    assert.equal(block.items[1]!.marker, "*");
  }
});

// ── Test 22: Inline nodes in list items ──────────────────────────────────
test("list item content parses inline nodes", () => {
  const doc = parseChatProse("- Use `config.ts` for settings");
  const block = doc.blocks[0]!;
  assert.equal(block.type, "list");
  if (block.type === "list") {
    const itemContent = block.items[0]!.content;
    const fileLinkNode = itemContent.find(n => n.type === "file-link");
    assert.ok(fileLinkNode, "expected file-link inside list item");
    if (fileLinkNode && fileLinkNode.type === "file-link") {
      assert.equal(fileLinkNode.path, "config.ts");
    }
  }
});

// ── Test 23: Jira ticket stack renders as separated cards ─────────────────
test("jira ticket stack parses linked tickets with metadata", () => {
  const input = [
    "Here are related tickets:",
    "",
    "[COOP-233](https://coop-ai.atlassian.net/browse/COOP-233)",
    "Status: Backlog",
    "Type: Task",
    "Updated: June 1, 2026",
    "Summary: VS Code marketplace review delay",
    "[COOP-232](https://coop-ai.atlassian.net/browse/COOP-232)",
    "Status: Backlog",
    "Type: Task",
    "Updated: June 1, 2026",
    "Summary: Demo seed placeholder (safe to delete)"
  ].join("\n");

  const doc = parseChatProse(input);
  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0]!.type, "paragraph");
  assert.equal(doc.blocks[1]!.type, "jira-ticket-stack");

  const stack = doc.blocks[1]!;
  if (stack.type === "jira-ticket-stack") {
    assert.equal(stack.tickets.length, 2);
    assert.equal(stack.tickets[0]!.key, "COOP-233");
    assert.equal(stack.tickets[0]!.summary, "VS Code marketplace review delay");
    assert.equal(stack.tickets[1]!.key, "COOP-232");
  }
});

// ── Summary ────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nchatProseParser: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
