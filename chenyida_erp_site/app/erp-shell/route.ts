import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Content-Type": "text/html; charset=utf-8",
  Pragma: "no-cache",
};

export async function GET() {
  const html = await readFile(join(process.cwd(), "public", "erp", "index.html"), "utf8");
  return new Response(html, { headers });
}

export async function HEAD() {
  return new Response(null, { headers });
}
