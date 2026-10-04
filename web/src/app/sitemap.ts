import type { MetadataRoute } from "next";

const origin = "https://wordle.jerkeyray.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/sign-in", "/play"].map((path) => ({ url: `${origin}${path}`, lastModified: new Date() }));
}
