import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class ApplicationVersionMetadataError extends Error {
  readonly code = "APPLICATION_VERSION_METADATA_INVALID";

  constructor() {
    super("运行时版本元数据不可用");
    this.name = "ApplicationVersionMetadataError";
  }
}

export function readApplicationVersion(packagePath: string): string {
  let metadata: unknown;
  try {
    metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    throw new ApplicationVersionMetadataError();
  }

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ApplicationVersionMetadataError();
  }

  const version = (metadata as { version?: unknown }).version;
  if (typeof version !== "string" || !PROJECT_VERSION_PATTERN.test(version)) {
    throw new ApplicationVersionMetadataError();
  }
  return version;
}

export function createApplicationVersionReader(
  packagePath: string = join(process.cwd(), "package.json"),
): () => string {
  let cachedVersion: string | undefined;
  return () => {
    if (cachedVersion === undefined) {
      cachedVersion = readApplicationVersion(packagePath);
    }
    return cachedVersion;
  };
}

const readRuntimeApplicationVersion = createApplicationVersionReader();

export function getApplicationVersion(): string {
  return readRuntimeApplicationVersion();
}
