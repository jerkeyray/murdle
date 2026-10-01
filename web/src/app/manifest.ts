import type { MetadataRoute } from "next";

/**
 * Installing to the home screen is most of what makes this feel like an app
 * rather than a website: no browser chrome, no address bar eating the top of
 * the board.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wordle",
    short_name: "Wordle",
    description: "Solve five words. Uncover one idea.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1a1016",
    theme_color: "#1a1016",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
