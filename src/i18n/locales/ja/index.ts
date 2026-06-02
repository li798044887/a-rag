import { auth } from "./auth";
import { chat } from "./chat";
import { common } from "./common";
import { documents } from "./documents";
import { feedback } from "./feedback";
import { modals } from "./modals";
import { sidebar } from "./sidebar";
import { sources } from "./sources";
import { uploads } from "./uploads";
import { workspace } from "./workspace";
import type { Dictionary } from "../zh";

/** : Dictionary 注解で zh とのキー対等を強制する。 */
export const ja: Dictionary = {
  auth,
  chat,
  common,
  documents,
  feedback,
  modals,
  sidebar,
  sources,
  uploads,
  workspace,
};
