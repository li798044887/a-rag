import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HelpModal } from "@/components/modals/help-modal";

const meta = {
  title: "Modals/HelpModal",
  component: HelpModal,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: { open: true, onClose: fn() },
} satisfies Meta<typeof HelpModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
