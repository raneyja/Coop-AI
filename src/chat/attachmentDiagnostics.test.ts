import assert from "node:assert/strict";
import { attachmentBodyMetadata, attachmentBundleMetadata, attachmentSerializedMetadata } from "./attachmentDiagnostics";
import { buildUserMessageWithContext, formatChatMessageWithLocalFiles } from "../prompts/systemPrompts";

const content = "private fixture source token=do-not-log";
const payload = { files: [{ path: "fixture.swift", content }] };
const meta = attachmentBodyMetadata(payload);
assert.equal(meta.fileCount, 1);
assert.equal(meta.bodyChars, content.length);
assert.match(meta.files[0].bodyHash, /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(meta).includes(content), false);
assert.deepEqual(attachmentBodyMetadata(), { fileCount: 0, bodyChars: 0, files: [] });
const message = `<local_files>\n<file_content path="fixture.swift">${content}</file_content>\n</local_files>`;
const serialized = attachmentSerializedMetadata(message);
assert.equal(serialized.fileContentBlockCount, 1);
assert.equal(serialized.localFilesBlockCount, 1);
assert.equal(serialized.serializedBodyChars, content.length);
assert.deepEqual(serialized.serializedBodyHashes, [meta.files[0].bodyHash]);
assert.equal(JSON.stringify(serialized).includes(content), false);
assert.equal(attachmentSerializedMetadata("filename only").fileContentBlockCount, 0);
assert.equal(attachmentBundleMetadata([]).fileCount, 0);
assert.deepEqual(attachmentBundleMetadata([{ data: { localFiles: payload } }]), meta);
assert.equal(attachmentBundleMetadata([{ data: { localFiles: payload } }, { data: { localFiles: { files: [] } } }]).fileCount, 1);
const bundle = [{ type: "chat_context", data: { localFiles: {
  source: "local-workspace", activeFile: "fixture.swift", fallbackLevel: "partial", files: payload.files
} } }];
for (const actualMessage of [
  formatChatMessageWithLocalFiles({ message: "Explain this file.", file: "fixture.swift", files: payload.files as Array<{ path: string; content: string }>, fileAssistant: true }),
  buildUserMessageWithContext("Explain this file.", { file: "fixture.swift", fileAssistant: true, contextBundle: bundle })
]) {
  const actual = attachmentSerializedMetadata(actualMessage);
  assert.equal(actual.localFilesBlockCount, 1);
  assert.equal(actual.fileContentBlockCount, attachmentBundleMetadata(bundle).fileCount);
  assert.equal(actual.serializedBodyChars, content.length + 2, "real serializer adds surrounding newlines");
  assert.deepEqual(actual.serializedBodyHashes, [attachmentBodyMetadata({ files: [{ content: `\n${content}\n` }] }).files[0].bodyHash]);
  assert.equal(JSON.stringify(actual).includes(content), false);
}
const filenameOnly = attachmentSerializedMetadata(buildUserMessageWithContext("Explain this file.", { file: "fixture.swift", fileAssistant: true }));
assert.equal(filenameOnly.fileContentBlockCount, 0);
assert.equal(filenameOnly.localFilesBlockCount, 0);
console.log("attachmentDiagnostics: metadata/hash/serialized/empty safety assertions passed");
