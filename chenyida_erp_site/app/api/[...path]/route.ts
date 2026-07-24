import { handleSelfhostApi } from "../../lib/selfhost-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSelfhostApi(request);
}

export async function POST(request: Request) {
  return handleSelfhostApi(request);
}

export async function PUT(request: Request) {
  return handleSelfhostApi(request);
}

export async function PATCH(request: Request) {
  return handleSelfhostApi(request);
}

export async function DELETE(request: Request) {
  return handleSelfhostApi(request);
}

export async function HEAD(request: Request) {
  return handleSelfhostApi(request);
}

export async function OPTIONS(request: Request) {
  return handleSelfhostApi(request);
}
