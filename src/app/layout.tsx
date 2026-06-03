import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_JP, IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { THEME_STORAGE_KEY } from "@/lib/constants";
import { getLocale } from "@/i18n/server";
import { htmlLang } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { LocaleProvider } from "@/i18n/context";
import "katex/dist/katex.min.css";
import "./globals.css";

// IBM Plex Sans（ラテン）— UI とラテン文字・数字の基幹書体。業務向けの中立的サンセリフ。
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// IBM Plex Sans JP（日本語）— 仮名・漢字を日本語字形で描画する既定 CJK 書体。
// 日本語グリフは unicode-range で必要分のみ遅延配信される（latin のみプリロード）。
const plexJp = IBM_Plex_Sans_JP({
  variable: "--font-plex-jp",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// IBM Plex Mono（等幅）— コードブロック・kbd 用。Plex ファミリーで見た目を統一。
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// IBM Plex Sans SC（簡体中国語）— 簡体字形を woff2 で自前ホスト。lang=zh の CJK に使う。
// next/font/google のカタログに SC 版が無いため自前配信する。実ウェイト 400/500/600/700 を
// 揃え、font-synthesis:none のまま合成太字による字重ムラを避ける。
const plexSc = localFont({
  variable: "--font-plex-sc",
  display: "swap",
  src: [
    { path: "./fonts/IBMPlexSansSC-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexSansSC-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexSansSC-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/IBMPlexSansSC-Bold.woff2", weight: "700", style: "normal" },
  ],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return {
    title: t.api.metaTitle,
    description: t.api.metaDescription,
  };
}

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return (
    <html
      lang={htmlLang(locale)}
      className={`${plexSans.variable} ${plexJp.variable} ${plexSc.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <LocaleProvider locale={locale} dict={dict}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
