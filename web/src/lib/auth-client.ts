"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // A client-side OAuth request must start on the origin displaying this app.
  // A localhost fallback works on the developer's laptop but sends phones to
  // their own loopback address on a deployed site.
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ??
        process.env.BETTER_AUTH_URL ??
        "http://localhost:3000",
});

export const { signIn, signUp, signOut, useSession } = authClient;
