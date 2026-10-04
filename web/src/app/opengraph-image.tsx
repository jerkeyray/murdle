import { ImageResponse } from "next/og";

// Default (Node) runtime: Vercel Services cannot deploy Edge functions, and
// with no dynamic inputs this image is rendered once at build time anyway.
export const alt = "Wordle word game";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const tiles = ["W", "O", "R", "D", "L"];
  return new ImageResponse(
    (
      <div style={{ background: "#171717", color: "#f5f3f1", display: "flex", height: "100%", width: "100%", padding: "68px 76px", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", color: "#a9a5a7", fontSize: 23, fontWeight: 700, letterSpacing: 7 }}>WORDLE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontFamily: "Georgia", fontSize: 72, fontWeight: 700, letterSpacing: -3 }}>Words worth keeping.</div>
          <div style={{ display: "flex", color: "#b8b4b6", fontSize: 30 }}>Solve, save words, and uncover the connection.</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {tiles.map((tile, index) => <div key={tile} style={{ alignItems: "center", background: index === 1 ? "#df4f8d" : index === 3 ? "#2fb894" : "#292929", borderRadius: 12, display: "flex", fontFamily: "Georgia", fontSize: 38, height: 72, justifyContent: "center", width: 72 }}>{tile}</div>)}
        </div>
      </div>
    ),
    size,
  );
}
