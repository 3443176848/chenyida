import { handleErpApi } from "../../lib/erp-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleErpApi(request);
}

export async function POST(request: Request) {
  return handleErpApi(request);
}

export async function PUT(request: Request) {
  return handleErpApi(request);
}

export async function PATCH(request: Request) {
  return handleErpApi(request);
}

export async function DELETE(request: Request) {
  return handleErpApi(request);
}

export async function HEAD(request: Request) {
  return handleErpApi(request);
}

export async function OPTIONS(request: Request) {
  return handleErpApi(request);
}
