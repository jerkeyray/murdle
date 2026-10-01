import { googleEnabled } from "@/lib/auth";

/**
 * What the sign-in screen is allowed to offer.
 *
 * The client cannot read GOOGLE_CLIENT_ID, and showing a Google button that
 * fails at the redirect is worse than not showing one. So the server says.
 */
export function GET() {
  return Response.json({ google: googleEnabled });
}
