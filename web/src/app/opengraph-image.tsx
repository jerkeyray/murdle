import { ImageResponse } from "next/og";

// Default (Node) runtime: Vercel Services cannot deploy Edge functions, and
// with no dynamic inputs this image is rendered once at build time anyway.
export const alt = "Wordle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WORDMARK = "Wordle";

/**
 * Fetches just the glyphs of the wordmark in Fraunces, the site's serif. The
 * legacy user agent makes Google Fonts serve woff, which Satori can read (it
 * cannot read woff2). If the fetch fails the card falls back to the default
 * font rather than failing the build.
 */
async function loadFraunces(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Fraunces:wght@600&text=${encodeURIComponent(WORDMARK)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30" } },
    ).then((res) => res.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:woff|truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((res) => res.arrayBuffer());
  } catch {
    return null;
  }
}

// The four squares of the app icon (see icon.svg), without its backdrop.
const TILES = ["#2fb894", "#3a2b34", "#3a2b34", "#e0568f"];

export default async function OpenGraphImage() {
  const fraunces = await loadFraunces();
  return new ImageResponse(
    (
      <div style={{ background: "#000", display: "flex", height: "100%", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 56 }}>
        <div style={{ display: "flex", flexWrap: "wrap", width: 176, gap: 16 }}>
          {TILES.map((color, index) => <div key={index} style={{ background: color, borderRadius: 14, height: 80, width: 80 }} />)}
        </div>
        <div style={{ display: "flex", color: "#f5f3f1", fontSize: 88, fontWeight: 600, letterSpacing: -2 }}>{WORDMARK}</div>
      </div>
    ),
    fraunces ? { ...size, fonts: [{ name: "Fraunces", data: fraunces, weight: 600, style: "normal" }] } : size,
  );
}
