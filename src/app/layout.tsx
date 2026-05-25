import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "@/lib/constants";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ARag — Agentic RAG",
  description:
    "社内ナレッジ（議事録・Wiki・Slack・DB）を横断するエージェント型 RAG アシスタント。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

/* Applies the persisted theme + accent before first paint to avoid a flash. */
const themeBootstrap = `
(function () {
  try {
    var raw = localStorage.getItem('${THEME_STORAGE_KEY}');
    var t = raw ? JSON.parse(raw) : {};
    var el = document.documentElement;
    el.classList.add(t.dark ? 'theme-dark' : 'theme-light');
    if (t.accent) el.style.setProperty('--accent', t.accent);
  } catch (e) {
    document.documentElement.classList.add('theme-light');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={`${jakarta.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
