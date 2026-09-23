# opencode-connector-cmc

OpenCode **Effect plugin** that exposes the [Command Code](https://commandcode.ai)
Provider API as an OpenCode provider.

`cmc` in the repo name is short for Command Code.

## Status

Scaffold. The plugin loads, registers the provider, and the endpoint is real and
reachable. Sending a request needs `CMD_API_KEY` — without it the API answers
`401`, and the plugin logs a warning telling you so.

## Requirements

- [Bun](https://bun.sh) (runtime)
- OpenCode `2.0.x`

## Setup

```sh
bun install
```

## Develop

`opencode.jsonc` points OpenCode at `./src`, so the plugin loads automatically
from this directory.

```sh
opencode plugin list   # opencode-connector-cmc  local
opencode models        # commandcode/deepseek/deepseek-v4-flash
                       # commandcode/zai-org/GLM-5.2, ...
```

Typecheck:

```sh
bun run typecheck
```

## Layout

| Path             | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `src/index.ts`   | Plugin entrypoint — the `Plugin.define` export          |
| `src/provider.ts`| Provider + model catalog definitions                    |
| `opencode.jsonc` | Local plugin registration for development               |

## Configuration

Pass options through `opencode.jsonc`:

```jsonc
{
  "plugins": [{ "package": "./src", "options": {} }],
}
```

Read them from `ctx.options` inside the plugin effect. `ctx.options` is
`PluginOptions`, not a typed shape of your own, so narrow unknown values before
use.

## Connect in the TUI

`/connect` lists **integrations**, not plugins. Two consequences:

- Look for the integration name **"Command Code"**. The plugin id
  `opencode-connector-cmc` never appears in `/connect` — it shows up in
  `opencode plugin list` instead.
- The plugin loads from **this project's** `opencode.jsonc`, so it only exists
  for this directory. Starting OpenCode somewhere else (e.g. your home folder)
  means no entry at all.

Registering a provider alone adds models but nothing to connect to. `/connect`
needs an integration, which is why `src/index.ts` registers one and
`src/provider.ts` links it through `Provider.Info.integrationID`.

Verify without opening the TUI:

```sh
opencode api --standalone GET /api/integration
# {"id":"commandcode","name":"Command Code",
#  "methods":[{"type":"key","label":"API key"},
#             {"type":"env","names":["CMD_API_KEY"]}],"connections":[]}
```

`--standalone` matters: it runs a private server rooted at the current
directory. The shared background service is anchored to one directory and will
not show integrations from other locations.

## Credentials

The integration offers two methods, mirroring the built-in providers:

| Method      | Behaviour                                              |
| ----------- | ------------------------------------------------------ |
| `key`       | Prompt for a secret, saved to the server SQLite DB      |
| `env`       | Read `CMD_API_KEY` from the server process              |

Preferred: connect through `/connect` so the key is stored by OpenCode.

As a fallback the plugin also reads `CMD_API_KEY` itself and passes it to the
adapter as a bearer token. Set it before starting OpenCode:

```sh
export CMD_API_KEY="..."      # bash / zsh
$env:CMD_API_KEY = "..."      # PowerShell
```

If it is missing the provider still registers (so models stay visible) and the
plugin logs a warning, rather than failing silently.

Get a key from [Studio → API keys](https://commandcode.ai/settings/keys) — the
same key authenticates the CLI and the API.

Requirements:

- Every Command Code plan **except Go** has Provider API access (GOAT, Pro, Max,
  Team, and Provider).
- The API expects `Authorization: Bearer <CMD_API_KEY>`.

The key is never committed: read it from the environment, and `.env` is already
in `.gitignore`.

## Models

Ids come from `GET /provider/v1/models`, and the upstream ids really do contain
a `/` — `commandcode/deepseek/deepseek-v4-flash` is `providerID` + upstream id.

Seeded catalog (`src/provider.ts`), all verified against the live catalog:

| Upstream id                  | Context     | Notes                        |
| ---------------------------- | ----------- | ---------------------------- |
| `deepseek/deepseek-v4-flash` | 1,000,000   | Command Code's default model |
| `zai-org/GLM-5.2`            | 1,000,000   | reasoning                    |
| `moonshotai/Kimi-K3`         | 1,000,000   | vision                       |
| `google/gemini-3.7-flash`    | 1,048,576   | vision                       |

`context` comes from the `context_length` field of that endpoint. `output` is
**not** published there, so it stays at the schema default (32,000) rather than
being invented.

## Limitations

- **Claude models are not included.** They answer only on `/v1/messages`
  (Anthropic schema), while this provider uses the OpenAI-compatible adapter and
  `/v1/chat/completions`. 9 of the 80 catalog entries are in this group.
- `typesafe/jev` is a decision model on `/v1/systemone`. It returns
  probabilities instead of text, so it cannot drive a session.
- Zero data retention (`x-cmd-zdr: 1`) is not wired up.
- Today the catalog is a manually chosen subset; `/provider/v1/models` is public
  and could be fetched at runtime instead.

## TODO

- [ ] Send `limit.output` per model once a real number is available
- [ ] Add per-model pricing (`cost`)
- [ ] Add a second provider entry for Claude via the Anthropic-compatible adapter
- [ ] Populate the catalog from `/provider/v1/models` instead of hand-picking
- [ ] Wire ZDR behind a plugin option

## Publish

```sh
bun pm pack
```

Then add to a consuming config:

```jsonc
{
  "plugins": ["opencode-connector-cmc@0.1.0"],
}
```
