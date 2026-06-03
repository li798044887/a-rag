import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import { THEME_STORAGE_KEY } from "@/lib/constants";
import { getLocale } from "@/i18n/server";
import { htmlLang } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { LocaleProvider } from "@/i18n/context";
import "katex/dist/katex.min.css";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Maple Mono CN（含 CJK の等幅）。CJK を単一フォントで描画し、lang 依存の
// フォールバックによる字重ムラを根治する。woff2 自前ホスト。
const maple = localFont({
  variable: "--font-maple",
  display: "swap",
  src: [
    { path: "./fonts/MapleMonoCN-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/MapleMonoCN-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/MapleMonoCN-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/MapleMonoCN-Bold.woff2", weight: "700", style: "normal" },
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
    <html lang={htmlLang(locale)} className={`${jakarta.variable} ${maple.variable}`} suppressHydrationWarning>
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
