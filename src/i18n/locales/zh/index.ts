import { api } from "./api";
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

/** zh は辞書の唯一の出所。型 Dictionary はここから導出する。 */
export const zh = {
  api,
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

export type Dictionary = typeof zh;
