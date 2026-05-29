import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ShareModal } from "@/components/modals/share-modal";
import { SAMPLE_SOURCES } from "@/lib/data";

const meta = {
  title: "Modals/ShareModal",
  component: ShareModal,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    item: SAMPLE_SOURCES[0],
    onClose: fn(),
    onCopyLink: fn(),
  },
} satisfies Meta<typeof ShareModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
