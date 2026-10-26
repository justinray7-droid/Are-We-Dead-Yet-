import { NextResponse, type NextRequest } from "next/server";
import { MEMBER_COOKIE, parseMemberId } from "@/lib/identity.ts";

// Until this browser has picked a name, every page goes to the picker.
export function middleware(request: NextRequest) {
  if (parseMemberId(request.cookies.get(MEMBER_COOKIE)?.value)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/who";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the picker itself and the files an iPhone fetches to install the app.
  matcher: ["/((?!who|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|icons/).*)"],
};
