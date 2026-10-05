import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The dev indicator sits in the bottom-left corner, exactly on top of the
  // Enter key. On a phone-sized viewport it intercepts the tap.
  devIndicators: false,
};

export default nextConfig;
