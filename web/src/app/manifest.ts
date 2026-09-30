import type { MetadataRoute } from "next";

/**
 * Installing to the home screen is most of what makes this feel like an app
 * rather than a website: no browser chrome, no address bar eating the top of
 * the board.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Murdle",
    short_name: "Murdle",
    description: "A word game for two people and one phone.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
