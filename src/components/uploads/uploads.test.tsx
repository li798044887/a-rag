import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DocumentsUploadQueue } from "@/components/uploads/uploads";
import { LocaleProvider } from "@/i18n/context";
import { ja } from "@/i18n/locales/ja";
import type { StagedFile } from "@/lib/types";

function uploadingFile(id: number): StagedFile {
  return {
    id: `f${id}`,
    name: `設計検証_${id}.pdf`,
    size: 1000 + id,
    status: "uploading",
    progress: 90,
    relPath: `02_研究開発_製品工程/設計検証_${id}.pdf`,
  };
}

test("documents upload queue keeps the scroll container inside the bounded queue shell", () => {
  const queue = createElement(DocumentsUploadQueue, {
    files: Array.from({ length: 12 }, (_, i) => uploadingFile(i)),
    onRemove: () => {},
    onRetry: () => {},
    onClear: () => {},
  });
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, { locale: "ja", dict: ja, children: queue }),
  );

  expect(html).toContain("max-h-[50vh]");
  expect(html).toContain("min-h-0 flex-1");
  expect(html).toContain("overflow-y-auto");
  expect(html).not.toContain("flex shrink-0 flex-col border-b");
  expect(html).not.toContain("max-h-[50vh] flex-col gap-1.5 overflow-y-auto");
});
