/** Unified line-icon library.
 *
 * All glyphs share a 16×16 viewBox, 1.3–1.5 stroke, and use `currentColor` so
 * callers tint via text color. Brand marks are simplified geometric hints. */
import type { ReactNode } from "react";

const glyphs = {
  // ── Navigation / chrome ──────────────────────────────────────────────
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10.5 10.5 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />,
  close: <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />,
  check: <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  chevronDown: <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  chevronLeft: <path d="M10 4 6 8l4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  chevronRight: <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  external: <path d="M6 3H3v10h10v-3M9 3h4v4M13 3l-6 6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,

  // ── Settings sidebar ─────────────────────────────────────────────────
  brain: <path d="M8 3a2.5 2.5 0 00-2.5 2.5c-1 0-1.8.8-1.8 1.8 0 .5.2 1 .5 1.3-.3.3-.5.8-.5 1.3 0 1 .8 1.8 1.8 1.8.2 1 1 1.8 2.5 1.8s2.3-.8 2.5-1.8c1 0 1.8-.8 1.8-1.8 0-.5-.2-1-.5-1.3.3-.3.5-.8.5-1.3 0-1-.8-1.8-1.8-1.8A2.5 2.5 0 008 3z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
  folders: (
    <>
      <path d="M2 6a1 1 0 011-1h2l1.3 1.3H10a1 1 0 011 1V11a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      <path d="M5 5V4a1 1 0 011-1h2l1.3 1.3H13a1 1 0 011 1V9.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 4.5h7M11.5 4.5h2M2.5 8h2M6.5 8h7M2.5 11.5h7M11.5 11.5h2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <circle cx="10.3" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="5.5" cy="8" r="1.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="10.3" cy="11.5" r="1.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  cog: (
    <>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  shield: <path d="M8 1.5l5.5 2v4.7c0 3.4-2.4 6.4-5.5 7.3-3.1-.9-5.5-3.9-5.5-7.3V3.5l5.5-2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  signout: <path d="M9 3H4a1 1 0 00-1 1v8a1 1 0 001 1h5M11 5l3 3-3 3M14 8H7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,

  // ── Sources / collections ────────────────────────────────────────────
  star: <path d="M8 2l1.85 4 4.15.4-3.1 2.8.9 4.1L8 11.2 4.2 13.3l.9-4.1L2 6.4l4.15-.4L8 2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  folder: <path d="M2 5a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  layers: <path d="M8 2l6 3-6 3-6-3 6-3zM2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </>
  ),
  book: <path d="M3 2.5h8a2 2 0 012 2v9.5a1 1 0 01-1.5.8L8 13l-3.5 1.8a1 1 0 01-1.5-.8V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  doc: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3M6 8h5M6 11h5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  chat: <path d="M2.5 12V4a1 1 0 011-1h9a1 1 0 011 1v6a1 1 0 01-1 1H5l-2.5 1.5V12z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  hash: <path d="M6 2L4.5 14M11.5 2L10 14M2.5 6h12M1.5 11h12" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />,
  meeting: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M5 2v3M11 2v3M2 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  code: <path d="M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3M9.5 3 6.5 13" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  table: <path d="M2.5 3h11v10h-11zM2.5 6.5h11M2.5 10h11M6 6.5v6.5M10 6.5v6.5" stroke="currentColor" strokeWidth="1.3" fill="none" />,
  target: (
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </>
  ),
  paperclip: <path d="M11 7l-4 4a2.5 2.5 0 003.5 3.5L14 11a4.5 4.5 0 00-6.4-6.4L4 8a2.5 2.5 0 003.5 3.5L10 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  database: (
    <>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M3 3.5v9c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5v-9M3 8c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  inbox: <path d="M2 9.5l1.5-6A1 1 0 014.5 3h7a1 1 0 011 .5l1.5 6V13H2V9.5zM2 9.5h3.5l1 2h3l1-2H14" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,

  // ── Brand marks (simplified, line-style) ─────────────────────────────
  confluence: (
    <>
      <path d="M2.5 12c2-1.6 4.3-1.6 6 0s4 1.6 5 0" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M2.5 4c2 1.6 4.3 1.6 6 0s4-1.6 5 0" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  notion: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M5.5 11.5V5.5l4 5V5.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="5.5" cy="5.2" r="0.5" fill="currentColor" />
    </>
  ),
  drive: <path d="M5.5 2.5h5L14 8l-3.5 5.5h-5L2 8l3.5-5.5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
  slack: (
    <>
      <rect x="2.5" y="6" width="3" height="1.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="8.4" y="6" width="3" height="1.6" rx="0.8" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="6.4" y="2.5" width="3" height="1.6" rx="0.8" transform="rotate(90 6.4 2.5)" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="11" y="8.4" width="3" height="1.6" rx="0.8" transform="rotate(90 11 8.4)" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </>
  ),
  github: (
    <>
      <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="12" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M4 5v6M12 5v3a3 3 0 01-3 3H6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  postgres: (
    <>
      <path d="M3.5 14v-9a2.5 2.5 0 015 0v3a1.5 1.5 0 01-3 0" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 8c2 0 3.5-1 3.5-3a3 3 0 00-3-3M8.5 14c1.5 0 3-.5 3-2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  linear: <path d="M2.5 9L9 2.5M5 12.5l7.5-7.5M9 14l5-5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />,

  // ── File-type marks ──────────────────────────────────────────────────
  filePdf: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M5.6 8.5h1.2c.5 0 .9.3.9.8s-.4.8-.9.8H5.6v1.5M9 11.6V8.5h.9c.7 0 1.1.6 1.1 1.5s-.4 1.6-1.1 1.6H9z" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    </>
  ),
  fileDoc: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M6 8h4M6 10h4M6 12h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  fileSheet: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M5.5 8h6M5.5 10h6M5.5 12h6M8.5 7.5v5" stroke="currentColor" strokeWidth="1" fill="none" />
    </>
  ),
  fileSlide: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <rect x="5.6" y="8" width="4.8" height="3.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </>
  ),
  fileImage: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="6.5" cy="9.2" r=".7" fill="currentColor" />
      <path d="M5.5 12.5l1.7-1.7 1.4 1.4 1.2-1.2 1.7 1.7" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" />
    </>
  ),
  fileCode: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M7.5 9l-1.5 1.5L7.5 12M8.5 9L10 10.5 8.5 12" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  fileText: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3M6 8h5M6 10h5M6 12h3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </>
  ),
  fileGeneric: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),

  // ── Actions ──────────────────────────────────────────────────────────
  copy: (
    <>
      <rect x="5" y="3" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M3 11V4.5A1.5 1.5 0 014.5 3H10" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  download: <path d="M8 2v9m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  share: (
    <>
      <circle cx="4" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M5.3 7.3 10.7 4.7M5.3 8.7l5.4 2.6" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  refresh: <path d="M13 8a5 5 0 11-1.5-3.5L13 6V3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  thumbsUp: <path d="M3 8h2v6H3zM5 8l3-5c0-1 1.5-1 1.5 0V7h3.5a1 1 0 011 1.3l-1.3 4a1 1 0 01-1 .7H5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
  thumbsDown: (
    <g transform="rotate(180 8 8)">
      <path d="M3 8h2v6H3zM5 8l3-5c0-1 1.5-1 1.5 0V7h3.5a1 1 0 011 1.3l-1.3 4a1 1 0 01-1 .7H5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    </g>
  ),
  stop: <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />,
  send: <path d="M8 13V3M8 3l-4 4M8 3l4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  arrowUp: <path d="M4 10l4-5 4 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  menu: <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,

  // ── Misc ─────────────────────────────────────────────────────────────
  sun: (
    <>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  moon: <path d="M13 9.2A5.5 5.5 0 016.8 3a.5.5 0 00-.6-.6 6.5 6.5 0 107.4 7.4.5.5 0 00-.6-.6z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M8 7v4M8 5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  alert: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
      <path d="M8 4v5M8 11v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  group: (
    <>
      <circle cx="6" cy="6.5" r="2.2" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="11" cy="6.5" r="1.7" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M2 13c0-1.7 1.8-3 4-3s4 1.3 4 3M10 13c0-1.4 1.4-2.5 3-2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  link: <path d="M7 9l2-2M5 11a3 3 0 010-4l2-2a3 3 0 014 4M11 5a3 3 0 010 4l-2 2a3 3 0 01-4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  bookmark: <path d="M4 2h8v12L8 11l-4 3V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
  spark: <path d="M8 1.5L9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6 8 1.5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof glyphs;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} aria-hidden="true">
      {glyphs[name]}
    </svg>
  );
}
