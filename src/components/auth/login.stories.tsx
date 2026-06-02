import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { Login } from "@/components/auth/login";
import { LocaleProvider } from "@/i18n/context";
import { getDictionary } from "@/i18n/dictionary";

const meta = {
  title: "Auth/Login",
  component: Login,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: { onSignIn: fn(), onRegister: fn() },
  decorators: [
    (Story) => (
      <LocaleProvider locale="ja" dict={getDictionary("ja")}>
        <Story />
      </LocaleProvider>
    ),
  ],
} satisfies Meta<typeof Login>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** メール+パスワードを入力してサインイン → onSignIn が入力値で呼ばれる。 */
export const SignInFlow: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(canvas.getByPlaceholderText("you@company.com"), "taro@example.com");
    await userEvent.type(canvas.getByPlaceholderText("8文字以上"), "password123");
    await userEvent.click(canvas.getByRole("button", { name: "サインイン" }));
    await expect(args.onSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ email: "taro@example.com", password: "password123" }),
    );
  },
};
