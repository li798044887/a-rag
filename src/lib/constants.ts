/** localStorage keys + cross-cutting constants. */
export const THEME_STORAGE_KEY = "arag.tweaks";
export const SESSION_STORAGE_KEY = "arag.session";
export const MODEL_STORAGE_KEY = "arag.model";
export const AGENT_CFG_STORAGE_KEY = "arag.agentCfg";

/** Auth cookie name used by the JWT routes + middleware. */
export const AUTH_COOKIE = "arag_token";

/** User-selectable accent presets (sage / coral / cobalt / violet). */
export const ACCENT_PRESETS = ["#3FA77E", "#D97757", "#3D7EE6", "#8B6FE0"] as const;

export const DEFAULT_ACCENT = ACCENT_PRESETS[0];

/** Accepted upload extensions (mirrors the composer file input).
 *  MinerU が解析できる docx/xlsx/pptx・PDF・画像と、テキストパーサで扱う
 *  md/txt/json/csv に限定する。旧バイナリ(.doc/.xls/.ppt)は変換器が無く未対応。 */
export const ACCEPTED_FILE_TYPES =
  ".pdf,.docx,.xlsx,.csv,.pptx,.txt,.md,.json,.png,.jpg,.jpeg";
