import { chat } from "./chat";
import { common } from "./common";
import { modals } from "./modals";

/** zh は辞書の唯一の出所。型 Dictionary はここから導出する。 */
export const zh = {
  chat,
  common,
  modals,
};

export type Dictionary = typeof zh;
