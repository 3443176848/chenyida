import { handleErpApi } from "../../lib/erp-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleErpApi(request);
}

export async function POST(request: Request) {
  return handleErpApi(request);
}
