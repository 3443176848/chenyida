import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KNOWN_CSS_ONLY_PREFIXES = ["planning-", "sourcing-"];

export function cssOnlyMissingAssets(manifest, existingFiles) {
  const dependencies = Object.values(manifest?.clientReferenceDeps || {});
  const references = new Map();
  for (const dependency of dependencies) {
    for (const asset of dependency?.js || []) {
      const filename = basename(String(asset));
      if (!references.has(filename)) references.set(filename, []);
      references.get(filename).push(dependency);
    }
  }
  const missing = [...references.keys()].filter((filename) => !existingFiles.has(filename));
  for (const filename of missing) {
    const prefix = KNOWN_CSS_ONLY_PREFIXES.find((candidate) => filename.startsWith(candidate));
    if (!prefix || !filename.endsWith(".js")) {
      throw new Error(`Vinext manifest references missing non-whitelisted client asset: ${filename}`);
    }
    const consumers = references.get(filename) || [];
    if (!consumers.length || consumers.some((dependency) => !(dependency.css || []).some((asset) => {
      const css = basename(String(asset));
      return css.startsWith(prefix) && css.endsWith(".css");
    }))) {
      throw new Error(`Missing ${filename} is not proven to be a known CSS-only chunk`);
    }
  }
  return missing.sort();
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function ensureTarget(root, manifestPath) {
  const manifestUrl = `${pathToFileURL(manifestPath).href}?postbuild=${Date.now()}-${Math.random()}`;
  const manifest = (await import(manifestUrl)).default;
  const assetsDirectory = resolve(root, "dist/client/assets");
  const referenced = new Set(
    Object.values(manifest?.clientReferenceDeps || {}).flatMap((dependency) => dependency?.js || []).map((asset) => basename(String(asset))),
  );
  const existing = new Set();
  for (const filename of referenced) if (await exists(resolve(assetsDirectory, filename))) existing.add(filename);
  const missing = cssOnlyMissingAssets(manifest, existing);
  await mkdir(assetsDirectory, { recursive: true });
  for (const filename of missing) await writeFile(resolve(assetsDirectory, filename), "export {};\n", { flag: "wx" });
  return missing;
}

async function main() {
  const projectRoot = resolve(process.cwd());
  const primaryManifest = resolve(projectRoot, "dist/server/ssr/__vite_rsc_assets_manifest.js");
  const standaloneRoot = resolve(projectRoot, "dist/standalone");
  const standaloneManifest = resolve(standaloneRoot, "dist/server/ssr/__vite_rsc_assets_manifest.js");
  if (!(await exists(primaryManifest)) || !(await exists(standaloneManifest))) {
    throw new Error("Vinext build manifests are missing; refusing to patch an incomplete build");
  }
  const primary = await ensureTarget(projectRoot, primaryManifest);
  const standalone = await ensureTarget(standaloneRoot, standaloneManifest);
  if (primary.join("\n") !== standalone.join("\n")) throw new Error("Vinext primary and standalone missing-asset sets differ");
  console.info(`vinext client asset consistency: ${primary.length ? `restored ${primary.join(",")}` : "complete"}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
