import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Sidebar } from "@/components/sidebar/sidebar";
import { SAMPLE_THREADS, DEFAULT_USER } from "@/lib/data";
import type { AppUser } from "@/lib/types";

const user = DEFAULT_USER satisfies AppUser;

const meta = {
  title: "Sidebar",
  component: Sidebar,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    collapsed: false,
    threads: SAMPLE_THREADS,
    activeThreadId: SAMPLE_THREADS[0]?.id ?? "",
    dark: false,
    user,
    onToggle: fn(),
    onSelectThread: fn(),
    onNewChat: fn(),
    onOpenSettings: fn(),
    onOpenHelp: fn(),
    onSignOut: fn(),
    onToggleTheme: fn(),
    onRenameThread: fn(),
    onDeleteThread: fn(),
    onToggleStar: fn(),
    onAddToProject: fn(),
    onOpenDataSources: fn(),
    dataSourceCount: 8,
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 展開状態。 */
export const Expanded: Story = {};

/** 折りたたみ状態。 */
export const Collapsed: Story = { args: { collapsed: true } };
