import vinext from "vinext";
import { defineConfig } from "vite";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import environmentProfiles from "../config/environments.json";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const environmentName = (process.env.ERP_ENV || "development").toLowerCase();
if (!(environmentName in environmentProfiles)) {
  throw new Error(`ERP_ENV must be development, test, or production; received ${environmentName}`);
}
const environmentProfile = environmentProfiles[environmentName as keyof typeof environmentProfiles];
const d1PersistPath = process.env.ERP_D1_PERSIST_PATH || ".wrangler/state";

if (environmentName === "test") {
  const resolvedTemp = resolve(tmpdir());
  const resolvedD1 = resolve(d1PersistPath);
  const relativeD1 = relative(resolvedTemp, resolvedD1);
  const testRoot = relativeD1.split(sep)[0];
  if (!isAbsolute(d1PersistPath) || relativeD1.startsWith("..") || !testRoot.startsWith("chenyida-erp-test-")) {
    throw new Error("Test D1 persistence must use an absolute chenyida-erp-test-* directory under the operating-system temporary directory");
  }
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    ERP_ENV: environmentName,
    ERP_API_URL: process.env.ERP_API_URL || environmentProfile.apiUrl,
    ERP_SITE_URL: process.env.ERP_SITE_URL || environmentProfile.siteUrl,
    ERP_LOG_LEVEL: process.env.ERP_LOG_LEVEL || environmentProfile.logLevel,
    ERP_DEBUG: process.env.ERP_DEBUG || String(environmentProfile.debug),
    ERP_SETUP_TOKEN: process.env.ERP_SETUP_TOKEN || "",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    envDir: process.env.ERP_VITE_ENV_DIR || ".",
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
        persistState: { path: d1PersistPath },
        remoteBindings: false,
      }),
    ],
  };
});
