import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/erp-shell";
  return NextResponse.rewrite(target);
}

export const config = { matcher: ["/erp/index.html"] };
