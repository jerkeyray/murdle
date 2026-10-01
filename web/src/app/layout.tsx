import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { Presence } from "@/components/Presence";

// The sans carries the chrome only: keyboard, labels, buttons. It stays
// quiet so it never competes with the words themselves.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// The serif does the real work — wordmark, board letters, and the entry at the
// end of a round. Putting it on the tiles is what makes the board read as type
// rather than as UI, and it ties the game to the dictionary entry it produces.
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wordle",
  description: "Solve five words. Uncover one idea.",
  appleWebApp: { capable: true, title: "Wordle", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a1016" },
    { media: "(prefers-color-scheme: light)", color: "#fcf0f4" },
  ],
};

/**
 * Applies the saved theme before first paint. Without this the page renders in
 * the default dark and then snaps to light, which is very visible on a phone
 * at night.
 */
const themeScript = `
(function () {
  try {
    var p = 'wordle.';
    var old = ['mur', 'dle.'].join('');
    var t = localStorage.getItem(p + 'theme') || localStorage.getItem(old + 'theme');
    var c = localStorage.getItem(p + 'contrast') || localStorage.getItem(old + 'contrast');
    if (!localStorage.getItem(p + 'theme') && t) localStorage.setItem(p + 'theme', t);
    if (!localStorage.getItem(p + 'contrast') && c) localStorage.setItem(p + 'contrast', c);
    localStorage.removeItem(old + 'theme');
    localStorage.removeItem(old + 'contrast');
    if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    if (c === 'cb') {
      document.documentElement.dataset.contrast = 'cb';
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${serif.variable}`}><Presence />{children}</body>
    </html>
  );
}
