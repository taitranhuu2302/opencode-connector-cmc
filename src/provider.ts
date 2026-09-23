import { Integration, Model, Provider } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { Schema } from "effect";

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
 * Read from the environment as a fallback for people who prefer not to run
 * `/connect`. Connecting through `/connect` is preferred and wins over this
 * value when both are present, so it is never able to shadow a stored credential.
 *
 * Set it in your shell before starting OpenCode:
 *
 *   export CMD_API_KEY="..."      # bash / zsh
 *   $env:CMD_API_KEY = "..."      # PowerShell
 */
const apiKey = process.env.CMD_API_KEY;

/**
 * True when the env fallback is absent. On its own this does NOT mean the user
 * cannot authenticate — a `/connect` credential also works — so the plugin also
 * checks the integration's active connection before warning.
 */
export const apiKeyMissing = !apiKey;

/**
 * Header that turns on zero data retention, and the env var the Command Code
 * CLI uses for the same thing.
 *
 * When set, Command Code routes the request only through ZDR-capable upstreams
 * and refuses rather than falling back (HTTP 422 `cmd_zdr_no_providers`). It also
 * restricts tools to the ones the client executes itself.
 */
export const zdrHeader = "x-cmd-zdr";
export const zdrEnvVar = "CMD_ZDR";

/**
 * Decide whether to ask for zero data retention.
 *
 * Opt-in, and deliberately not a default:
 *
 * - The docs state ~99% of models already run on ZDR upstreams without the flag,
 *   so enabling it buys little for most traffic.
 * - It is strict: a model with no ZDR upstream fails with 422 instead of being
 *   served, turning "works" into "errors" for those models.
 * - ZDR capacity costs more and meters at the plan's default allowance, so the
 *   same credits buy fewer requests.
 *
 * So it stays a choice the user makes. The plugin option wins over the
 * environment, matching how `CMD_API_KEY` is only a fallback elsewhere.
 */
export function resolveZdr(
  options: Readonly<Record<string, unknown>>,
): boolean {
  if (typeof options.zdr === "boolean") return options.zdr;
  return process.env[zdrEnvVar] === "1";
}

/**
 * Provider metadata.
 *
 * Built per load rather than as a constant because the ZDR header depends on
 * plugin options, which only exist inside the plugin effect.
 */
export function providerInfo(zdr: boolean): Provider.Info {
  return {
    ...Provider.Info.empty(providerID),
    name: "Command Code",
    activation: "enabled",
    package: "@opencode/ai/providers/openai-compatible",
    // Links the provider to the integration so `/connect` can collect credentials.
    integrationID,
    // Sent by the server, not the plugin: verified on the wire.
    ...(zdr ? { headers: { [zdrHeader]: "1" } } : {}),
    settings: {
      baseURL,
      // Spread rather than `apiKey: undefined`, so the key is simply absent when unset.
      ...(apiKey ? { apiKey } : {}),
    },
  };
}

/**
 * Catalog endpoint. Public — it answers without credentials, which is what makes
 * runtime discovery possible at all.
 */
export const catalogURL = `${baseURL}/models`;

/** How long the catalog gets before we give up and use the seed list. */
const catalogTimeoutMs = 10_000;

/**
 * One entry of `GET /provider/v1/models`, as far as we rely on it. Fields are
 * `unknown` because this is untrusted network input and is validated on read.
 */
interface CatalogEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly context_length?: unknown;
  readonly supported_endpoints?: unknown;
}

/** The one transport this OpenAI-compatible adapter can speak. */
const chatCompletions = "/chat/completions";

/**
 * The catalog does not publish capabilities, so anything richer than "text in,
 * text out" has to be declared by hand. Keyed by upstream id — add an entry when
 * a model is confirmed to accept images.
 */
const visionModels: ReadonlySet<string> = new Set([
  "moonshotai/Kimi-K3",
  "google/gemini-3.7-flash",
]);

/**
 * Hand-picked models used only when the catalog cannot be reached.
 *
 * Deliberately small: its job is to keep the provider usable on a bad network,
 * not to be the catalog. Context numbers are the live `context_length` values.
 */
export const seedModels: readonly Model.Info[] = [
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

/**
 * Map one catalog entry to a model definition, or drop it when unusable.
 *
 * `supported_endpoints` is what keeps the catalog honest: entries that do not
 * answer on the transport this adapter speaks would be broken choices in the
 * picker (Claude models only speak `/v1/messages`, for example), so they are
 * omitted rather than advertised.
 */
function toModel(entry: CatalogEntry): Model.Info | undefined {
  if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;

  const endpoints = Array.isArray(entry.supported_endpoints)
    ? entry.supported_endpoints.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (!endpoints.includes(chatCompletions)) return undefined;

  const info = Model.Info.default(providerID, Model.ID.make(entry.id));
  const context =
    typeof entry.context_length === "number" && entry.context_length > 0
      ? entry.context_length
      : info.limit.context;

  return {
    ...info,
    name:
      typeof entry.name === "string" && entry.name.length > 0
        ? entry.name
        : entry.id,
    capabilities: {
      tools: true,
      // The schema default claims image support; only say so when we mean it.
      input: visionModels.has(entry.id) ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    // Output ceiling is not published by the API, so it keeps the schema default.
    limit: { ...info.limit, context },
  };
}

/** Maps raw catalog entries to model definitions, dropping unusable ones. */
function parseEntries(entries: readonly unknown[]): readonly Model.Info[] {
  return (
    entries
      .map((entry) => toModel(entry as CatalogEntry))
      .filter((model): model is Model.Info => model !== undefined)
      // Sorted so the picker order is stable across runs.
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

/**
 * A catalog plus the raw entries it was built from.
 *
 * The raw entries are carried along so they can be cached. Persisting the
 * upstream payload rather than the derived models keeps `toModel` the only place
 * that interprets the API: an improved mapping applies to data cached by an
 * older build too, instead of being frozen into it.
 */
export interface Catalog {
  readonly models: readonly Model.Info[];
  readonly entries: readonly unknown[];
}

/**
 * Fetch the catalog from the API.
 *
 * Ids come from `GET /provider/v1/models` and genuinely contain a `/` —
 * `commandcode/deepseek/deepseek-v4-flash` is `providerID` plus upstream id.
 *
 * Returns `undefined` when the catalog cannot be read, leaving the caller to
 * decide what to keep and what to say about it.
 */
export const fetchCatalog: Effect.Effect<Catalog | undefined> = Effect.gen(
  function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(catalogURL, { signal }).then((res) => res.json()),
      catch: (error) => error,
    }).pipe(
      Effect.timeout(catalogTimeoutMs),
      Effect.orElseSucceed(() => undefined),
    );

    const raw =
      response !== null && typeof response === "object" && "data" in response
        ? (response as { readonly data?: unknown }).data
        : undefined;
    if (!Array.isArray(raw)) return undefined;

    const models = parseEntries(raw);
    if (models.length === 0) return undefined;

    return { models, entries: raw };
  },
);

/**
 * Storage key for the cached catalog.
 *
 * A bare name is enough: the server namespaces plugin storage itself, storing
 * this as `plugin:<plugin id>:catalog`. Verified against the `kv` table.
 */
export const catalogCacheKey = "catalog";

/** Bumped whenever the cached shape changes, so older entries are ignored. */
const catalogCacheVersion = 1;

/** A cache entry, plus when it was written. */
export interface CachedCatalog extends Catalog {
  readonly fetchedAt: number;
}

/** Serialize a fetched catalog for storage. */
export function encodeCatalogCache(
  catalog: Catalog,
  fetchedAt: number,
): Schema.Json {
  return {
    version: catalogCacheVersion,
    fetchedAt,
    entries: catalog.entries as unknown as Schema.Json,
  };
}

/**
 * Read a previously cached catalog.
 *
 * Validated defensively rather than trusted: the value was written by a possibly
 * older build, so anything unexpected is treated as "no cache" instead of being
 * assumed to have the shape this version expects.
 */
export function decodeCatalogCache(value: unknown): CachedCatalog | undefined {
  if (value === null || typeof value !== "object") return undefined;

  const cache = value as Partial<{
    version: unknown;
    fetchedAt: unknown;
    entries: unknown;
  }>;
  if (cache.version !== catalogCacheVersion) return undefined;
  if (!Array.isArray(cache.entries)) return undefined;

  const models = parseEntries(cache.entries);
  if (models.length === 0) return undefined;

  return {
    models,
    entries: cache.entries,
    fetchedAt: typeof cache.fetchedAt === "number" ? cache.fetchedAt : 0,
  };
}
