import { chat } from "./chat";
import { common } from "./common";
import { modals } from "./modals";
import { sidebar } from "./sidebar";
import type { Dictionary } from "../zh";

/** : Dictionary 注解で zh とのキー対等を強制する。 */
export const ja: Dictionary = {
  chat,
  common,
  modals,
  sidebar,
};
