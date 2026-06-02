import { common } from "./common";

/** zh は辞書の唯一の出所。型 Dictionary はここから導出する。 */
export const zh = {
  common,
};

export type Dictionary = typeof zh;
