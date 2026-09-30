import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Every auth route, including the JWKS endpoint that the Go API verifies
 * tokens against.
 */
export const { GET, POST } = toNextJsHandler(auth);
