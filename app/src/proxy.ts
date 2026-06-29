import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth is skipped entirely when DASHBOARD_PASSWORD is unset (trusted LAN use).
// The webhook route stays public; it is authenticated by its HMAC signature.
// /api/health stays public for container healthchecks.
const publicPaths = ["/api/webhooks/", "/api/health"];

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (publicPaths.some((path) => pathname.startsWith(path))) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="githubers"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
