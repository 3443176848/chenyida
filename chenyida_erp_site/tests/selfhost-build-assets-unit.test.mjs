import assert from "node:assert/strict";
import test from "node:test";
import { cssOnlyMissingAssets } from "../scripts/ensure-vinext-client-assets.mjs";

const manifest = (js, css) => ({ clientReferenceDeps: { client: { js, css } } });

test("postbuild restores only the proven Vinext CSS-only chunks", () => {
  assert.deepEqual(cssOnlyMissingAssets(
    { clientReferenceDeps: {
      sourcing: { js: ["/assets/page-a.js", "/assets/sourcing-hash.js"], css: ["/assets/sourcing-style.css"] },
      planning: { js: ["/assets/planning-hash.js"], css: ["/assets/planning-style.css"] },
    } },
    new Set(["page-a.js"]),
  ), ["planning-hash.js", "sourcing-hash.js"]);
  assert.deepEqual(cssOnlyMissingAssets(
    manifest(["/assets/page-a.js", "/assets/sourcing-hash.js"], ["/assets/sourcing-style.css"]),
    new Set(["page-a.js", "sourcing-hash.js"]),
  ), []);
});

test("postbuild fails closed for missing executable chunks or unproven sourcing chunks", () => {
  assert.throws(
    () => cssOnlyMissingAssets(manifest(["/assets/business-hash.js"], ["/assets/sourcing-style.css"]), new Set()),
    /non-whitelisted/,
  );
  assert.throws(
    () => cssOnlyMissingAssets(manifest(["/assets/sourcing-hash.js"], ["/assets/other-style.css"]), new Set()),
    /not proven/,
  );
});
