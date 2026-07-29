function normalizeOrigin(value: string, variableName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) origin`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.hostname.includes('*')) {
    throw new Error(`${variableName} must be an exact HTTP(S) origin without credentials, wildcard, path, query, or fragment`);
  }
  return parsed.origin;
}

export function normalizePublicOrigin(value: string | undefined): string | null {
  const candidate = value?.trim() || "";
  return candidate ? normalizeOrigin(candidate, "ERP_PUBLIC_ORIGIN") : null;
}

function normalizeHeaderOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizeOrigin(value, "Origin");
  } catch {
    return null;
  }
}

export function requestOriginMatches(request: Request, publicOrigin: string | null): boolean {
  const suppliedOrigin = normalizeHeaderOrigin(request.headers.get("origin"));
  if (!suppliedOrigin) return false;
  return publicOrigin !== null
    ? suppliedOrigin === publicOrigin
    : suppliedOrigin === new URL(request.url).origin;
}
