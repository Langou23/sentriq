import type { NextRequest } from "next/server";
import { updateSession } from "@/modules/auth/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Keep public assets in explicit namespaces; private URLs may have extensions.
  matcher: [
    "/((?!_next/static(?:/|$)|_next/image(?:/|$)|icons(?:/|$)|favicon\\.ico$|manifest\\.webmanifest$).*)",
  ],
};
