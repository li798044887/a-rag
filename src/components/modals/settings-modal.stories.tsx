import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SettingsModal } from "@/components/modals/settings-modal";
import { MODELS, DEFAULT_USER } from "@/lib/data";
import type { AgentCfg, Tweaks, AppUser } from "@/lib/types";
import type { SessionClaims } from "@/hooks/use-auth";

const tweaks: Tweaks = {
  dark: false,
  accent: "#3fa77e",
  toolView: "card",
  density: "comfy",
  citationStyle: "numbered",
};

const agentCfg: AgentCfg = {
  maxSteps: 12,
  parallelTools: 3,
  requireCitations: true,
  admitUnknown: true,
  topK: 6,
  candidateK: 10,
};

const now = Math.floor(Date.now() / 1000);
const claims: SessionClaims = {
  sub: "user_123",
  email: DEFAULT_USER.email,
  org: DEFAULT_USER.org,
  role: "member",
  scopes: ["chat:read", "chat:write", "docs:read"],
  iat: now - 3600,
  exp: now + 3600 * 24,
  iss: "arag",
  aud: "arag-web",
  rem: true,
};

const meta = {
  title: "Modals/SettingsModal",
  component: SettingsModal,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    model: MODELS[0],
    tweaks,
    user: DEFAULT_USER satisfies AppUser,
    claims,
    onClose: fn(),
    onModelChange: fn(),
    setTweak: fn(),
    agentCfg,
    setAgentCfg: fn(),
    onSetRemember: fn(),
    onRevokeAllSessions: fn(),
    onSaveName: fn(),
  },
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** クレーム未取得（ローディング相当）。 */
export const NoClaims: Story = { args: { claims: null } };
