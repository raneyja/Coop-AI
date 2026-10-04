# Autocomplete and session qualification

Scope: independent automated verification; no desktop actions, billing, commits, or deployment.

## Proven defect and repair

The added router regression reproduced an in-flight completion being reused after its suffix changed, merely because the new prefix extended the old prefix. Before the repair, the parent-run autocomplete suite reported 20 passing router checks and this new check failing. The repair requires unchanged surrounding code (language, suffix/window, preceding lines, imports, and parent signature) before prefix-extension reuse. The parent reran the focused router suite: 21/21 passed.

The provider's late-result compatibility now checks the same surrounding fields. Its regression accepts ordinary prefix typing and rejects changes to each surrounding field. Parent reran the focused provider suite: 5/5 passed. Parent owns final full-suite/lint verification; results should be recorded after those commands complete.

## Existing coverage and limits

Router tests verify graph fields when explicitly enabled or the index is healthy, and exclusion in file-assistant mode. These establish request construction, not live graph-grounded suggestion quality. Autocomplete preference persistence, Copilot/suggest-widget coexistence, and trigger/filter/router behavior have existing automated suites. Parent runs the complete autocomplete suite.

Parent reports the chat-thread suite passed. This covers restoration/storage, activation, hydration, selected-ref remote citations, and remote view identity under mock fixtures. It does not establish expired-session or other-account recovery in the installed extension.

Parent independently verified stopping after final text began, unchanged stopped text, and a successful next turn; see ../live/partial-stop.json. The separate unresponsive-window observation remains unresolved and must not be attributed to this extension without additional evidence.

The local autocomplete.log and threads.log contain the initial sandbox DNS failures and are not successful test results. No live autocomplete claim is made by this agent. Indexed grounding, dismiss/cycle/switch behavior, provider coexistence in the installed editor, network fault recovery, and account switching remain live checks.
