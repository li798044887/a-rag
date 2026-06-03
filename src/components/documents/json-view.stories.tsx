import type { StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { JsonView, JsonlView } from "@/components/documents/json-view";

const meta = {
  title: "Documents/JsonView",
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

export const Object_: Story = {
  render: () => <JsonView text='{"name":"康脉","items":[1,2,3],"ok":true,"note":null}' />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('"name"')).toBeInTheDocument();
    await expect(canvas.getByText("true")).toBeInTheDocument();
  },
};

export const Invalid: Story = {
  render: () => <JsonView text="{これは JSON ではない}" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/解析できませんでした/)).toBeInTheDocument();
  },
};

export const Lines: Story = {
  render: () => <JsonlView text={'{"q":"Q1","a":"A1"}\n{"q":"Q2","a":"A2"}'} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("#1")).toBeInTheDocument();
    await expect(canvas.getByText("#2")).toBeInTheDocument();
  },
};
