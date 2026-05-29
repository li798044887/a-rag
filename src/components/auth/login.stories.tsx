import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Login } from "@/components/auth/login";

const meta = {
  title: "Auth/Login",
  component: Login,
  parameters: { layout: "fullscreen" },
  args: { onSignIn: fn(), onRegister: fn() },
} satisfies Meta<typeof Login>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
