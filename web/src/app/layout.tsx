import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Fraunces } from "next/font/google";
import "./globals.css";

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
  title: "Murdle",
  description: "A word game for two people and one phone.",
  appleWebApp: { capable: true, title: "Murdle", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The board is a fixed-height layout; letting it zoom just breaks it.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#13110f" },
    { media: "(prefers-color-scheme: light)", color: "#f7f3ea" },
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
    var t = localStorage.getItem('murdle.theme');
    if (!t) t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    if (localStorage.getItem('murdle.contrast') === 'cb') {
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
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
