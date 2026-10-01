import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

/**
 * Better Auth owns sessions and identity; the Go API owns the game.
 *
 * The two meet over a JWT. Better Auth signs one and publishes its public keys
 * at /api/auth/jwks, and Go verifies incoming tokens against that endpoint. Go
 * issues nothing and stores no credentials, so there is exactly one place in
 * the system that knows how to make a session.
 *
 * Both halves share one Neon database. Better Auth manages its own four tables
 * and Go's migrations stay out of them; Go's `players` table references
 * `"user".id` and that is the only crossing point.
 */
/**
 * Google is only offered when it is actually configured.
 *
 * Better Auth will happily register a provider with undefined credentials and
 * then fail at the redirect, which looks like a broken app rather than an
 * unfinished setup. Leaving it out means the button simply is not there.
 */
const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }
  : undefined;

/** Whether the sign-in screen should offer Google. */
export const googleEnabled = google !== undefined;

export const auth = betterAuth({
  // The pooled connection: this runs per request, which is exactly what
  // Neon's pooler is for. Migrations use the direct URL instead.
  database: new Pool({ connectionString: process.env.DATABASE_URL }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  // Google only. Inventing a password for a word game is friction nobody
  // wants, and an email flow with no mail sender behind it is worse than none.
  emailAndPassword: { enabled: false },

  session: {
    // Long sessions on purpose. This lives on a phone that gets picked up a
    // few times a week; being logged out is pure friction with no security
    // benefit for a word game.
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },

  socialProviders: google,

  plugins: [jwt()],
} satisfies BetterAuthOptions);
