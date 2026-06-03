import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
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

// IBM Plex Mono（等幅）— コードブロック・kbd 用。Plex ファミリーで見た目を統一。
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Noto Sans CJK JP（= 思源黑体）の可変フル版を自前ホスト。日中韓の全グリフを 1 ファイルに
// 内蔵し、OpenType の locl 機能が <html lang> に応じて地域字形（ja=日本語字形 / zh=簡体字形）を
// 自動選択する。単一フォントなので簡体専用字（电/资/库 等）も別フォントへ脱落せず、
// クロスフォントの字重ムラが原理的に起きない。wght 軸 100–900 を持ち 600 も実ウェイトで出せる。
const notoCjk = localFont({
  variable: "--font-noto-cjk",
  display: "swap",
  src: "./fonts/NotoSansCJKjp-VF.woff2",
  weight: "100 900",
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
      className={`${plexSans.variable} ${notoCjk.variable} ${plexMono.variable}`}
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
