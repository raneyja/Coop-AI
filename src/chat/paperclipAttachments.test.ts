import assert from "node:assert/strict";
import test from "node:test";
import {
  appendUserPaperclipAttachmentsPrompt,
  decodeDataUrlText,
  isAcceptedPaperclipMimeType,
  paperclipAttachmentKind,
  paperclipAttachmentTextContent
} from "./paperclipAttachments";

test("isAcceptedPaperclipMimeType accepts images, pdf, and markdown", () => {
  assert.equal(isAcceptedPaperclipMimeType("image/png", "x.png"), true);
  assert.equal(isAcceptedPaperclipMimeType("application/pdf", "doc.pdf"), true);
  assert.equal(isAcceptedPaperclipMimeType("text/markdown", "notes.md"), true);
  assert.equal(isAcceptedPaperclipMimeType("application/octet-stream", "notes.md"), true);
  assert.equal(isAcceptedPaperclipMimeType("application/octet-stream", "archive.zip"), false);
});

test("paperclipAttachmentKind classifies common uploads", () => {
  assert.equal(paperclipAttachmentKind("image/png", "a.png"), "image");
  assert.equal(paperclipAttachmentKind("application/pdf", "spec.pdf"), "pdf");
  assert.equal(paperclipAttachmentKind("text/plain", "readme.txt"), "text");
  assert.equal(paperclipAttachmentKind("application/octet-stream", "README.md"), "text");
});

test("appendUserPaperclipAttachmentsPrompt inlines text file content", () => {
  const text = Buffer.from("# Title\n\nBody", "utf8").toString("base64");
  const result = appendUserPaperclipAttachmentsPrompt("Summarize this doc", [
    {
      id: "f-1",
      name: "notes.md",
      mimeType: "text/markdown",
      dataUrl: `data:text/markdown;base64,${text}`
    }
  ]);
  assert.ok(result.includes("## User-attached file (paperclip)"));
  assert.ok(result.includes("notes.md (text (content inlined below))"));
  assert.ok(result.includes("<user_attached_files>"));
  assert.ok(result.includes("# Title"));
  assert.ok(!result.includes("multimodal image"));
});

test("appendUserPaperclipAttachmentsPrompt lists images without saying image-only", () => {
  const result = appendUserPaperclipAttachmentsPrompt("", [
    {
      id: "f-1",
      name: "screenshot.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,abc"
    }
  ]);
  assert.ok(result.includes("## User-attached file (paperclip)"));
  assert.ok(result.includes("screenshot.png (image (sent as multimodal content))"));
});

test("decodeDataUrlText handles plain and base64 payloads", () => {
  assert.equal(decodeDataUrlText("data:text/plain,hello%20world"), "hello world");
  const encoded = Buffer.from("line", "utf8").toString("base64");
  assert.equal(decodeDataUrlText(`data:text/plain;base64,${encoded}`), "line");
});

test("paperclipAttachmentTextContent truncates very large files", () => {
  const huge = "x".repeat(130_000);
  const encoded = Buffer.from(huge, "utf8").toString("base64");
  const content = paperclipAttachmentTextContent({
    id: "f-1",
    name: "big.txt",
    mimeType: "text/plain",
    dataUrl: `data:text/plain;base64,${encoded}`
  });
  assert.ok(content);
  assert.ok(content.includes("[truncated"));
});
