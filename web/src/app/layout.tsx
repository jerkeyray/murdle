import type { Metadata, Viewport } from "next";
import { Outfit, Fraunces } from "next/font/google";
import "./globals.css";

// Tight geometric sans for the board and UI: the letters need to read
// instantly at a glance from across a shared phone.
const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// A serif with some character for the learn card, so the teaching moment at
// the end of a round reads like something worth reading rather than more UI.
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
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
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
