import assert from "node:assert/strict";
import { verifyIndexArtifacts } from "./indexVerification";

void (async () => {
  assert.equal(verifyIndexArtifacts({ fileCount: 10, symbolCount: 0, zoektAvailable: false }).ok, true);
  assert.equal(verifyIndexArtifacts({ fileCount: 0, symbolCount: 3, zoektAvailable: false }).ok, true);
  assert.equal(verifyIndexArtifacts({ fileCount: 0, symbolCount: 0, zoektAvailable: true }).ok, true);

  const empty = verifyIndexArtifacts({ fileCount: 0, symbolCount: 0, zoektAvailable: false });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.match(empty.message, /no searchable artifacts/i);
  }

  console.log("indexVerification: 1/1 tests passed");
})();
