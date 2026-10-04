# Cold repository picker

Parent observed a new chat's Remote workspace initially showing “No repositories found. Connect GitHub in Settings.” Existing authenticated indexed repositories appeared on Refresh. The observation does not establish a connection/grant failure.

Source inspection identified three concrete problems: opening the picker did not set local loading before host response; repository listing did not await shared initialization; and repository rows were copied into component state only after the first render, so even an available initial snapshot painted an empty list before its effect ran. The default empty copy also asserted a GitHub connection requirement without evidence.

Prepared changes: synchronous local loading on repository request; direct rendering/filtering from the complete repository snapshot; neutral returned-empty copy. Parent owns the host initialization wait and explicit signed-out error. No directory-tree behavior or grant policy was changed.

Added actual host prototype regression covers blocked initialization, authenticated initial repository preservation, and signed-out failure without workspace API calls. An SSR component regression covers initial loading, populated initial snapshot, confirmed empty response, and explicit failure. Parent owns execution/build and the installed-extension cold-open/Refresh retest. Live Pass remains open until that retest.

The separately observed New Chat selection omission is not repaired here: fresh-window blank context is an explicit product policy, and current evidence does not establish whether the clicked source selection was active at capture. Parent should qualify immediate and settled remote selection capture without changing that policy speculatively.
