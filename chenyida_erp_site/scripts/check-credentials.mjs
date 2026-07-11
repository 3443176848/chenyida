import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const repoRoot = resolve(siteRoot, "..");
const allowedHostingKeys = new Set(["project_id", "d1", "r2"]);
const blockedPathPatterns = [
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:pem|key|p12|pfx|sqlite3?|db|log)$/i,
  /(^|\/)(?:backup|backups)(?:\/|$)/i,
];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)-(?:live|proj)-[A-Za-z0-9_-]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/i,
  /\bart_v1_[A-Za-z0-9_-]{20,}\b/,
];
const placeholderPattern = /^(?:replace|example|placeholder|changeme|local-|test-|<|\$\{|required)/i;

function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
}

async function main() {
  const issues = [];
  const files = repositoryFiles();
  for (const path of files) {
    if (blockedPathPatterns.some((pattern) => pattern.test(path)) && !path.endsWith(".env.example")) {
      issues.push(`${path}: sensitive or runtime-generated file type is tracked`);
      continue;
    }
    let contents;
    try {
      contents = await readFile(resolve(repoRoot, path), "utf8");
    } catch {
      continue;
    }
    if (contents.includes("\0")) continue;
    for (const pattern of secretPatterns) {
      if (pattern.test(contents)) issues.push(`${path}: content matches a prohibited credential pattern`);
    }
    if (path.endsWith(".env.example")) {
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*)=(.*)$/);
        if (match && match[2] && !placeholderPattern.test(match[2])) {
          issues.push(`${path}: ${match[1]} must use an obvious placeholder`);
        }
      }
    }
  }

  const hosting = JSON.parse(await readFile(resolve(siteRoot, ".openai", "hosting.json"), "utf8"));
  for (const key of Object.keys(hosting)) {
    if (!allowedHostingKeys.has(key)) issues.push(`chenyida_erp_site/.openai/hosting.json: unexpected key ${key}`);
  }

  if (issues.length) {
    console.error("CREDENTIAL_CHECK_FAILED");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`CREDENTIAL_CHECK_OK (${files.length} repository files scanned)`);
}

main().catch((error) => {
  console.error(`CREDENTIAL_CHECK_FAILED: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
