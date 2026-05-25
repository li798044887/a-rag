/** localStorage keys + cross-cutting constants. */
export const THEME_STORAGE_KEY = "arag.tweaks";
export const SESSION_STORAGE_KEY = "arag.session";

/** Auth cookie name used by the JWT routes + middleware. */
export const AUTH_COOKIE = "arag_token";

/** User-selectable accent presets (sage / coral / cobalt / violet). */
export const ACCENT_PRESETS = ["#3FA77E", "#D97757", "#3D7EE6", "#8B6FE0"] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0];

/** Accepted upload extensions (mirrors the composer file input). */
export const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.json,.png,.jpg,.jpeg";
