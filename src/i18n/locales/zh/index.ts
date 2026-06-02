import { auth } from "./auth";
import { chat } from "./chat";
import { common } from "./common";
import { documents } from "./documents";
import { modals } from "./modals";
import { sidebar } from "./sidebar";
import { sources } from "./sources";
import { uploads } from "./uploads";

/** zh は辞書の唯一の出所。型 Dictionary はここから導出する。 */
export const zh = {
  auth,
  chat,
  common,
  documents,
  modals,
  sidebar,
  sources,
  uploads,
};

export type Dictionary = typeof zh;
