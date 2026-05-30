import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { PanelResizer } from "@/components/sources/panel-resizer";

function Harness() {
  const [w, setW] = useState(420);
  return (
    <div style={{ position: "relative", height: 200, width: 480, border: "1px solid #ccc" }}>
      <PanelResizer width={w} onWidth={setW} />
      <span data-testid="w">{w}</span>
    </div>
  );
}

const meta = {
  title: "Sources/PanelResizer",
  component: Harness,
  tags: ["ai-generated"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ArrowLeft で広がり、ダブルクリックで既定幅に戻る。 */
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    const sep = canvas.getByRole("separator");
    sep.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(canvas.getByTestId("w").textContent).toBe("436"));

    await userEvent.dblClick(sep);
    await waitFor(() => expect(canvas.getByTestId("w").textContent).toBe("420"));
  },
};
