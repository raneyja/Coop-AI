# Implementation handoff — next causal check

The recovery coordinator ran `npm run lint` successfully on HEAD `36cf801040cf6666c68f93c7cd579802a4ccec43`. This is only a TypeScript/CI gate.

## Exact path to instrument

The attached-file body crosses these source boundaries in `src/chat/CoopChatSession.ts`:

1. `loadLocalFilesSyncForChat()` captures an immediate editor/remote-tab body.
2. `resolveChatLocalFiles()` reuses the pending body or calls `readFileAssistantEditorForChat()`, remote-tab reads, or `fetchRemoteFileForChatAttach()`.
3. `continueChatAfterContext()` calls `recordAttachedFileReads()`, injects/merges local files into `turn.contextBundle`, then isolates that bundle.
4. `buildUserMessageWithContext()` renders `<local_files>` from the bundle, while `formatChatMessageWithLocalFiles()` is the direct local-body route.
5. `streamChat()` receives the resulting `apiMessage` and only a compact context identity; it cannot recover a body absent from `apiMessage`.

## Required safe diagnostics

For one exact turn, record only metadata: file path label, `fileSource`, owner/repo/branch, route (`file-assistant` or `indexed-repo`), fetch attempted/outcome, body character count and hash, local-file count in the post-isolation bundle, serialized message body marker/count, and final request/build IDs. Never log private source contents or credentials.

Interpretation:

- body absent at `resolveChatLocalFiles`: producer/editor/code-host fetch boundary;
- present there but absent after isolation: turn/bundle isolation boundary;
- present in bundle but absent from `apiMessage`: prompt serialization boundary;
- present in `apiMessage` but answer still claims filename-only: backend/model or candidate mismatch.

Do not repair the Swift workflow until one of these boundaries is observed. Then add the regression at that real producer/consumer boundary and rerun the two exact prompts plus a verified control file.
