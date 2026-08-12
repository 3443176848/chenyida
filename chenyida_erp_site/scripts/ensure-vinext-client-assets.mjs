import { access, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KNOWN_CSS_ONLY_PREFIXES = ["planning-", "sourcing-"];
const IMAGE_SIZE_VERSION = "2.0.2";
const EXPECTED_IMAGE_SIZE_REFERENCES = [
  "node_modules/vinext/dist/index.js:image-size",
  "node_modules/vinext/dist/server/metadata-route-build-data.js:image-size",
];
const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

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

async function javascriptFiles(root, excludedRoot = null) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = resolve(directory, entry.name);
      if (excludedRoot && candidate === excludedRoot) continue;
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(extname(entry.name))) files.push(candidate);
    }
  };
  await visit(root);
  return files.sort();
}

function literalModuleSpecifiers(source) {
  const values = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    const declaration = trimmed.match(/^(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+)["']([^"']+)["']/);
    if (declaration) values.push(declaration[1]);
    const calls = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of line.matchAll(calls)) values.push(match[1]);
  }
  return values;
}

async function staticRuntimeGraph(standaloneRoot) {
  const entry = resolve(standaloneRoot, "server.js");
  const vinextServer = resolve(standaloneRoot, "node_modules/vinext/dist/server/prod-server.js");
  const queue = [entry];
  const visited = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of literalModuleSpecifiers(source)) {
      let dependency = null;
      if (specifier === "vinext/server/prod-server") dependency = vinextServer;
      else if (specifier.startsWith("./") || specifier.startsWith("../")) dependency = resolve(dirname(file), specifier);
      if (!dependency) continue;
      if (!JAVASCRIPT_EXTENSIONS.has(extname(dependency))) dependency = `${dependency}.js`;
      if (!(await exists(dependency))) throw new Error(`Vinext runtime graph references a missing module: ${relative(standaloneRoot, dependency)}`);
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return visited;
}

export function validateImageSizePruneFacts({ lockEntry, packageMetadata, references, runtimeFiles }) {
  if (lockEntry?.version !== IMAGE_SIZE_VERSION || lockEntry?.dev !== true) {
    throw new Error("image-size is no longer the expected dev-only lockfile dependency");
  }
  if (packageMetadata?.name !== "image-size" || packageMetadata?.version !== IMAGE_SIZE_VERSION) {
    throw new Error("standalone image-size package identity changed");
  }
  const normalizedReferences = [...references].sort();
  if (normalizedReferences.length !== EXPECTED_IMAGE_SIZE_REFERENCES.length
      || normalizedReferences.some((value, index) => value !== EXPECTED_IMAGE_SIZE_REFERENCES[index])) {
    throw new Error("standalone image-size reference set changed");
  }
  const reachable = new Set(runtimeFiles);
  if (normalizedReferences.some((value) => reachable.has(value.slice(0, value.lastIndexOf(":"))))) {
    throw new Error("image-size became reachable from the standalone runtime entry");
  }
  return { package: `image-size@${IMAGE_SIZE_VERSION}`, references: normalizedReferences };
}

async function pruneBuildOnlyImageSize(projectRoot) {
  const standaloneRoot = resolve(projectRoot, "dist/standalone");
  const nodeModulesRoot = resolve(standaloneRoot, "node_modules");
  const packageRoot = resolve(nodeModulesRoot, "image-size");
  const [nodeModulesStat, packageStat] = await Promise.all([lstat(nodeModulesRoot), lstat(packageRoot)]);
  if (!nodeModulesStat.isDirectory() || nodeModulesStat.isSymbolicLink() || !packageStat.isDirectory() || packageStat.isSymbolicLink()) {
    throw new Error("standalone image-size path is not a trusted directory");
  }
  if (await realpath(nodeModulesRoot) !== nodeModulesRoot || await realpath(packageRoot) !== packageRoot) {
    throw new Error("standalone image-size path escapes the build output");
  }
  const [lockfile, packageMetadata] = await Promise.all([
    readFile(resolve(projectRoot, "package-lock.json"), "utf8").then(JSON.parse),
    readFile(resolve(packageRoot, "package.json"), "utf8").then(JSON.parse),
  ]);
  const references = [];
  for (const file of await javascriptFiles(standaloneRoot, packageRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of literalModuleSpecifiers(source)) {
      if (specifier === "image-size" || specifier.startsWith("image-size/")) {
        references.push(`${relative(standaloneRoot, file)}:${specifier}`);
      }
    }
  }
  const runtimeFiles = [...await staticRuntimeGraph(standaloneRoot)].map((file) => relative(standaloneRoot, file));
  const proof = validateImageSizePruneFacts({
    lockEntry: lockfile?.packages?.["node_modules/image-size"],
    packageMetadata,
    references,
    runtimeFiles,
  });
  await rm(packageRoot, { recursive: true });
  if (await exists(packageRoot)) throw new Error("standalone image-size package was not removed");
  return proof;
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
  const pruned = await pruneBuildOnlyImageSize(projectRoot);
  console.info(`vinext standalone dependency pruning: removed ${pruned.package} after ${pruned.references.length} build-only references were verified`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
