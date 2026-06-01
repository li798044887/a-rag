import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { SpreadsheetGrid } from "@/components/documents/spreadsheet-grid";
import type { GridModel } from "@/components/documents/spreadsheet-model";

function makeGrid(rows: (string | null)[][]): GridModel {
  return {
    rowCount: rows.length,
    colCount: rows[0]?.length ?? 0,
    cells: rows,
    numeric: rows.map((row) => row.map((v) => v != null && /^[\d,.-]+$/.test(v))),
    merges: [],
    colWidths: rows[0]?.map(() => null) ?? [],
  };
}

const baseGrid = makeGrid([
  ["日期", "时间"],
  ["2025-03-17", "09:00-10:00"],
  ["2025-03-18", "14:00-16:00"],
  ["2025-03-21", "全天"],
]);

const meta = {
  title: "Documents/SpreadsheetGrid",
  component: SpreadsheetGrid,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    sheetNames: ["2025Q1", "2025Q2"],
    activeSheet: 0,
    onSelectSheet: fn(),
    grid: baseGrid,
    clamped: false,
    totalRows: 4,
    downloadHref: "#",
  },
} satisfies Meta<typeof SpreadsheetGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText("日期")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "2025Q2" }));
    await expect(args.onSelectSheet).toHaveBeenCalledWith(1);
  },
};

/** セル結合（見出しを 2 列にまたがって表示）。 */
export const Merged: Story = {
  args: {
    grid: {
      ...makeGrid([
        ["月次予定", null],
        ["2025-03-17", "09:00-10:00"],
      ]),
      merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
    },
    sheetNames: ["Sheet1"],
    totalRows: 2,
  },
  play: async ({ canvas }) => {
    const cell = within(canvas.getByText("月次予定").closest("td")!);
    await expect(cell).toBeTruthy();
  },
};

/** 行クランプの注記が出るケース。 */
export const Clamped: Story = {
  args: {
    clamped: true,
    totalRows: 5000,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/先頭/)).toBeInTheDocument();
  },
};
