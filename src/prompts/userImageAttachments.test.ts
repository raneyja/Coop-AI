import assert from "node:assert/strict";
import test from "node:test";
import { appendUserImageAttachmentsPrompt } from "./userImageAttachments";

const sampleAttachment = {
  id: "img-1",
  name: "screenshot.png",
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,abc"
};

test("appendUserImageAttachmentsPrompt returns message unchanged when no attachments", () => {
  assert.equal(appendUserImageAttachmentsPrompt("Hello", undefined), "Hello");
  assert.equal(appendUserImageAttachmentsPrompt("Hello", []), "Hello");
});

test("appendUserImageAttachmentsPrompt adds paperclip section for a single image", () => {
  const result = appendUserImageAttachmentsPrompt("What is this diagram?", [sampleAttachment]);
  assert.ok(result.startsWith("What is this diagram?"));
  assert.ok(result.includes("## User-attached image (paperclip)"));
  assert.ok(result.includes("screenshot.png (image/png)"));
  assert.ok(result.includes("multimodal image content"));
  assert.ok(result.includes("Do not conflate these uploads"));
});

test("appendUserImageAttachmentsPrompt works when message is empty", () => {
  const result = appendUserImageAttachmentsPrompt("", [sampleAttachment]);
  assert.ok(result.includes("## User-attached image (paperclip)"));
  assert.ok(result.includes("screenshot.png (image/png)"));
  assert.equal(result.startsWith("\n"), false);
});

test("appendUserImageAttachmentsPrompt pluralizes for multiple images", () => {
  const result = appendUserImageAttachmentsPrompt("Compare these", [
    sampleAttachment,
    { ...sampleAttachment, id: "img-2", name: "flow.webp", mimeType: "image/webp" }
  ]);
  assert.ok(result.includes("## User-attached images (paperclip)"));
  assert.ok(result.includes("attached 2 images"));
  assert.ok(result.includes("flow.webp (image/webp)"));
});
