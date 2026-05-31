import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useRef } from "react";
import { fn } from "storybook/test";
import { ScopePicker } from "@/components/chat/scope-picker";
import { SCOPE_PRESETS } from "@/lib/data";
import type { ScopeValue } from "@/lib/types";

const initialScope: ScopeValue = { ...SCOPE_PRESETS[0] };

const meta = {
  title: "Chat/ScopePicker",
  component: ScopePicker,
  tags: ["ai-generated"],
  parameters: { layout: "centered" },
  // 実際の anchorRef は render 内で差し替える。型を満たすための既定値。
  args: {
    open: true,
    anchorRef: createRef<HTMLButtonElement>(),
    value: initialScope,
    attachmentCount: 0,
    onChange: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ScopePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function OpenScopePicker() {
  // anchorRef が指す実ボタンを描画し、その上に popover を出す。
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="grid min-h-[360px] place-items-end pb-10">
      <button
        ref={ref}
        className="rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-fg"
      >
        スコープ: {initialScope.label}
      </button>
      <ScopePicker
        open
        anchorRef={ref}
        value={initialScope}
        attachmentCount={0}
        onChange={fn()}
        onClose={fn()}
      />
    </div>
  );
}

/** アンカーボタンを基準に展開されるポップオーバー。 */
export const Open: Story = {
  render: () => <OpenScopePicker />,
};
