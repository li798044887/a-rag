"use client";

import { useCallback, useState } from "react";
import { ConfirmModal, type ConfirmModalProps } from "@/components/modals/confirm-modal";

export type ConfirmOptions = Omit<ConfirmModalProps, "open" | "onConfirm" | "onCancel">;

/** モーダル確認ダイアログを Promise ベースで呼び出す。
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: "削除しますか？", tone: "danger" }))) return;
 *
 * 呼び出し側は JSX 内で `{dialog}` を一度だけレンダリングする。 */
export function useConfirm() {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ options, resolve });
      }),
    [],
  );

  const dialog = state ? (
    <ConfirmModal
      {...state.options}
      open
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
      onCancel={() => {
        state.resolve(false);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, dialog };
}
