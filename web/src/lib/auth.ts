import { betterAuth } from "better-auth";
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
export const auth = betterAuth({
  // The pooled connection: this runs per request, which is exactly what
  // Neon's pooler is for. Migrations use the direct URL instead.
  database: new Pool({ connectionString: process.env.DATABASE_URL }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  emailAndPassword: {
    enabled: true,
    // There is no mail sender wired up yet, and blocking sign-in on an email
    // nobody can send would lock the two of you out of your own game.
    requireEmailVerification: false,
  },

  session: {
    // Long sessions on purpose. This lives on a phone that gets picked up a
    // few times a week; being logged out is pure friction with no security
    // benefit for a word game.
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },

  plugins: [jwt()],
});
