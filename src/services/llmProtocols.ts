import type { LlmProtocol } from "@/types/domain";

/**
 * The three request shapes an endpoint can speak, with the default address for
 * each. Not vendor names: an OpenAI-compatible gateway is "openai" whoever runs
 * it, and every address here is editable.
 *
 * Gemini's default includes `/v1beta` so that `{base}/models` is the listing
 * path for all three — the backend relies on that too.
 */
export const LLM_PROTOCOLS: Array<{
  value: LlmProtocol;
  label: string;
  defaultBaseUrl: string;
  hint: string;
}> = [
  {
    value: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    hint: "/chat/completions with a Bearer token. Most gateways speak this."
  },
  {
    value: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    hint: "/messages with an x-api-key header."
  },
  {
    value: "gemini",
    label: "Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    hint: ":streamGenerateContent with an x-goog-api-key header."
  }
];

export function defaultBaseUrl(protocol: LlmProtocol) {
  return LLM_PROTOCOLS.find((entry) => entry.value === protocol)?.defaultBaseUrl ?? "";
}
