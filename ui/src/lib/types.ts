// Shared types that mirror the gateway contract exactly (see ui/NOTES.md).
// Kept in their own module so both surfaces can import the shapes without the
// member bundle pulling in any telemetry *calls*.

export interface Verdict {
  layer: string;
  decision: string; // allow | block | park | refuse | flag | info
  detail: string;
  score: number | null;
  pack: string;
  profile: string;
  phone_hash: string;
  extra: Record<string, unknown>;
  at: number; // epoch seconds
}

export interface PendingSummary {
  action_id: string | null;
  tool: string;
  requires: string[];
  args: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  verdicts: Verdict[];
  pending: PendingSummary[];
  blocked_by: string | null;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  phone_hash: string;
  member_confirmed: boolean;
  officer_approved: boolean;
  created_at: string;
  expires_at: string;
}

export interface McpServer {
  name: string;
  url: string;
  tools: string[];
  pinned_ok: boolean;
  expected_pin: string;
  actual_pin: string;
  error: string;
}

export interface AdminState {
  profile: string; // naked | hardened (deploy-time)
  pack: string;
  packs: string[];
  switches: Record<string, boolean>;
  provider: string; // mistral | ollama (deploy-time)
  shieldstral_mode: string; // live | cached (deploy-time)
  embed_dim: number;
  admin_token_required: boolean;
  servers: McpServer[];
}

// The six real guard switches, in pipeline order, with operator-facing labels.
export const LAYER_KEYS = [
  "input_guard",
  "expert_guard",
  "provenance",
  "registry",
  "tool_gate",
  "budgets",
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

export const LAYER_LABELS: Record<LayerKey, string> = {
  input_guard: "L1 · Input guard",
  expert_guard: "L2 · Expert guard",
  provenance: "Retrieval provenance",
  registry: "L3 · Registry",
  tool_gate: "L4 · Tool gate",
  budgets: "Token & message budgets",
};

// Decision → semantic colour token (matches index.css).
export type Tone = "allow" | "block" | "park" | "flag" | "info";

export function decisionTone(decision: string): Tone {
  switch (decision) {
    case "allow":
      return "allow";
    case "block":
    case "refuse":
      return "block";
    case "park":
    case "capped":
      return "park";
    case "flag":
      return "flag";
    default:
      return "info";
  }
}
