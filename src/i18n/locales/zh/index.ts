import { chat } from "./chat";
import { common } from "./common";
import { modals } from "./modals";
import { sidebar } from "./sidebar";

/** zh は辞書の唯一の出所。型 Dictionary はここから導出する。 */
export const zh = {
  chat,
  common,
  modals,
  sidebar,
};

export type Dictionary = typeof zh;
