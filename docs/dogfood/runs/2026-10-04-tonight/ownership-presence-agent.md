# Ownership presence assessment

Status: owned source frozen; targeted Automated Pass. No new live pass, deployment, or commit claimed.

Parent observed a post-deploy ownership answer saying the contributor was reachable/available now. The evidence card contained Slack presence for that contributor, so the claim was not evidence-free and the fixture's intended lack of Slack usage does not establish disconnected access. The particular identity mapping and presence observation remain independently unverified.

Confirmed source defects repaired:

- Team-member availability defaulted true when activity was missing and otherwise equated contribution recency with availability. It now remains unverified even when Slack reports active. Raw presence stays on the ownership score; formatted team members always say response availability is unverified. No identified production consumer besides prompt formatting used that legacy availability flag.
- Presence and identity-resolution caches were process-global across Slack clients. They are now scoped to the client connection through WeakMaps. Directory mapping edits invalidate the identity cache using the actual matched person record, preserving identifier case rather than only comparing person count.
- A directory person whose explicit Slack lookup failed could resolve through inferred name lookup yet receive a “linked” label. Explicit linkage now requires the resolution source to be explicit; inferred fallback remains labeled inferred.
- Ownership synthesis explicitly distinguishes observed active presence from reachability, response availability, or on-call status and preserves inferred identity qualification. Citation guidance no longer invites guaranteed availability claims from presence.

Targeted commands, each exit 0:

- `npx --yes tsx src/api/slack/presenceCheck.test.ts` — 9/9, including connection-separated identity/presence state, same-size edited directory invalidation, inferred fallback labeling, and explicit reset invalidating both connection-scoped caches.
- `npx --yes tsx src/api/codeHosts/ownershipAnalysis.test.ts` — 10/10, including missing/recent activity and active presence failing to establish response availability.
- `npx --yes tsx src/prompts/ownershipSynthesis.test.ts` — 14/14, including legacy available=true formatting remaining unverified.

Whitespace/diff checks passed. Parent lint caught the old reset helper still referencing removed global Maps; that missed conversion was corrected to replace both WeakMaps, with the reset regression above. Combined lint/build/CI must rerun on the corrected source. Parent owns those gates and candidate publication/deployment decisions. Live retest must distinguish actual Slack presence and explicit versus inferred identity from guaranteed response availability. Current inferred name matching is still heuristic; the repair qualifies it honestly rather than treating it as a verified person link. No claim is made that these defects caused the exact observed presence mapping.
