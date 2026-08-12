import assert from "node:assert/strict";
import test from "node:test";
import { cssOnlyMissingAssets, validateImageSizePruneFacts } from "../scripts/ensure-vinext-client-assets.mjs";

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

test("postbuild prunes only the exact dev-only image-size package outside the runtime graph", () => {
  const facts = {
    lockEntry: { version: "2.0.2", dev: true },
    packageMetadata: { name: "image-size", version: "2.0.2" },
    references: [
      "node_modules/vinext/dist/index.js:image-size",
      "node_modules/vinext/dist/server/metadata-route-build-data.js:image-size",
    ],
    runtimeFiles: ["server.js", "node_modules/vinext/dist/server/prod-server.js"],
  };
  assert.deepEqual(validateImageSizePruneFacts(facts), {
    package: "image-size@2.0.2",
    references: [...facts.references].sort(),
  });
  assert.throws(() => validateImageSizePruneFacts({ ...facts, lockEntry: { version: "2.0.2", dev: false } }), /dev-only/);
  assert.throws(() => validateImageSizePruneFacts({ ...facts, packageMetadata: { name: "image-size", version: "2.0.3" } }), /identity changed/);
  assert.throws(() => validateImageSizePruneFacts({ ...facts, references: [...facts.references, "server.js:image-size"] }), /reference set changed/);
  assert.throws(() => validateImageSizePruneFacts({ ...facts, runtimeFiles: [...facts.runtimeFiles, "node_modules/vinext/dist/index.js"] }), /became reachable/);
});
