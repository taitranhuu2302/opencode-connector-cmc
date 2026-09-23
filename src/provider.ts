import { Integration, Model, Provider } from "@opencode/plugin/effect";

/** Provider id used by `model: "<id>/<model>"` references in opencode.json(c). */
export const providerID = Provider.ID.make("commandcode");

/**
 * Integration id. `/connect` lists *integrations*, not providers, so the
 * provider stays invisible there until it is linked to one. The credential
 * table behind `/connect` stores this same id (`connector_id`).
 */
export const integrationID = Integration.ID.make("commandcode");

/**
 * Command Code Provider API.
 *
 * OpenAI-compatible: authenticates with `Authorization: Bearer <CMD_API_KEY>`
 * and speaks the Chat Completions schema.
 *
 * Claude models answer only on `/v1/messages`, and `typesafe/jev` only on
 * `/v1/systemone`, so neither can be served by this OpenAI-compatible provider.
 */
export const baseURL = "https://api.commandcode.ai/provider/v1";

/**
 * Read from the environment so the key never has to live in the repo.
 *
 * Set it in your shell before starting OpenCode:
 *
 *   export CMD_API_KEY="..."      # bash / zsh
 *   $env:CMD_API_KEY = "..."      # PowerShell
 */
const apiKey = process.env.CMD_API_KEY;

/** True when no key was found, so the plugin can say so instead of failing mute. */
export const apiKeyMissing = !apiKey;

export const provider: Provider.Info = {
  ...Provider.Info.empty(providerID),
  name: "Command Code",
  activation: "enabled",
  package: "@opencode/ai/providers/openai-compatible",
  // Links the provider to the integration so `/connect` can collect credentials.
  integrationID,
  settings: {
    baseURL,
    // Spread rather than `apiKey: undefined`, so the key is simply absent when unset.
    ...(apiKey ? { apiKey } : {}),
  },
};

/**
 * Starting catalog.
 *
 * Ids are the ones `GET /provider/v1/models` reports; the upstream ids contain
 * a `/`, which is intentional. Only models that answer on `/v1/chat/completions`
 * belong here.
 *
 * `limit.context` is the `context_length` that endpoint reports, verified
 * against the live catalog. `limit.output` is NOT published by the API, so it
 * stays at the schema default (32000) rather than being invented.
 */
export const models: readonly Model.Info[] = [
  {
    ...Model.Info.default(
      providerID,
      Model.ID.make("deepseek/deepseek-v4-flash"),
    ),
    name: "DeepSeek V4 Flash",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    ...Model.Info.default(providerID, Model.ID.make("zai-org/GLM-5.2")),
    name: "GLM-5.2",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    ...Model.Info.default(providerID, Model.ID.make("moonshotai/Kimi-K3")),
    name: "Kimi K3",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    limit: { context: 1_000_000, output: 32_000 },
  },
  {
    ...Model.Info.default(providerID, Model.ID.make("google/gemini-3.7-flash")),
    name: "Gemini 3.7 Flash",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    limit: { context: 1_048_576, output: 32_000 },
  },
];
