# opencode-connector-cmc

OpenCode **Effect plugin** that exposes the [Command Code](https://commandcode.ai)
Provider API as an OpenCode provider.

`cmc` in the repo name is short for Command Code.

## Status

Working and verified end-to-end. The plugin loads, registers the provider and
its integration, and credentials collected through `/connect` are injected into
outgoing requests as `Authorization: Bearer <key>`.

Authenticate either way:

- `/connect` → **Command Code** (preferred; stored by OpenCode), or
- `CMD_API_KEY` in the environment (fallback, used only when no stored
  credential exists).

## Requirements

- [Bun](https://bun.sh) (runtime)
- OpenCode `2.0.x`

## Setup

```sh
bun install
```

## Global install

Installed globally, so Command Code is available in **every** directory rather
than only this checkout. Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "/Users/taitran/Desktop/opencode-connector-cmc/src",
      "options": {}
    }
  ]
}
```

Then, from any directory:

```sh
cd ~           # or anywhere outside this repo
opencode plugin list   # opencode-connector-cmc  local  .../src/index.ts
opencode models        # commandcode/... (71 models)
```

Verified from `/tmp` — the provider and its full catalog appear with no project
config involved.

### Don't also register it locally

Declaring the plugin in both the global config **and** this repo's
`opencode.jsonc` loads it twice: the duplicate registers the same provider, emits
the startup warnings twice, and runs the catalog refresh twice. That is why this
repo's `opencode.jsonc` intentionally has an empty `plugins` array.

### Options

The config entry is used rather than a symlink in `~/.config/opencode/plugins/`
because **only a config entry can pass options** — a symlink or a file dropped in
the plugins directory is loaded with no options at all, so `zdr` would be
unreachable except through the `CMD_ZDR` environment variable.

Set `"zdr": true` in `options` to turn on zero data retention globally; see
[Zero data retention](#zero-data-retention) for what that costs.

### Caveats

- The path is absolute, so moving or deleting this checkout breaks the global
  install. Update the path, or switch to a published package, if that happens.
- Edits to `src/` are picked up on the next OpenCode start, since the plugin is
  loaded from source.

## Develop

`opencode.jsonc` no longer registers the plugin — the global install above covers
this directory, and registering it here as well would double-load it. To develop
without touching the global config, re-add the local entry:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "./src", "options": {} }],
}
```

Once loaded, from this directory:

```sh
opencode plugin list   # opencode-connector-cmc  local
opencode models        # commandcode/deepseek/deepseek-v4-flash
                       # commandcode/zai-org/GLM-5.2, ... (71 models)
```

The model list is fetched from the API at startup, so it tracks the provider
rather than a file in this repo. See [Models](#models).

Typecheck:

```sh
bun run typecheck
```

## Layout

| Path             | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `src/index.ts`   | Plugin entrypoint — registration, cache read, refresh    |
| `src/provider.ts`| Provider metadata, seed models, catalog fetch, cache     |
| `opencode.jsonc` | Project config; plugin registration lives globally       |

## Configuration

Options are passed through the `plugins` entry — in the global config for a
global install, or in this repo's `opencode.jsonc` during development:

```jsonc
{
  "plugins": [
    {
      "package": "/Users/taitran/Desktop/opencode-connector-cmc/src",
      "options": { "zdr": true },
    },
  ],
}
```

| Option | Type      | Default | Effect                                        |
| ------ | --------- | ------- | --------------------------------------------- |
| `zdr`  | `boolean` | `false` | Send `x-cmd-zdr: 1`. See [Zero data retention](#zero-data-retention). |

Read them from `ctx.options` inside the plugin effect. `ctx.options` is
`PluginOptions` (`Readonly<Record<string, any>>`), not a typed shape of your own,
so every value is narrowed before use — `resolveZdr` accepts only an actual
boolean and ignores anything else.

## Connect in the TUI

`/connect` lists **integrations**, not plugins. Two consequences:

- Look for the integration name **"Command Code"**. The plugin id
  `opencode-connector-cmc` never appears in `/connect` — it shows up in
  `opencode plugin list` instead.
- Because the plugin is installed globally (see
  [Global install](#global-install)), the integration is offered everywhere, not
  only inside this checkout.

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

`connections` stays empty until you connect; afterwards it holds an entry like
`{"type":"credential","id":"cred_...","label":"...","method":"key"}`.

`--standalone` matters: it runs a private server rooted at the current
directory. The shared background service is anchored to one directory and will
not show integrations from other locations.

To exercise the connect flow itself you need a *persistent* server.
`--standalone` keeps registration in an in-memory store, so the per-id and
connect routes return `404 IntegrationNotFoundError` — for built-in
integrations too, so it is not a sign of a broken plugin:

```sh
opencode serve --port 4599 --hostname 127.0.0.1   # prints a password
PASSWORD=...                                       # from the line above
curl -u "opencode:$PASSWORD" -X POST \
  -H 'content-type: application/json' \
  -d '{"key":"<your key>","label":"cli"}' \
  http://127.0.0.1:4599/api/integration/commandcode/connect/key
opencode auth list                                 # Command Code  cli  stored
```

The local API authenticates with HTTP **Basic** (`opencode:<password>`), not
`Authorization: Bearer`.

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

Connecting through `/connect` is preferred and takes precedence: a stored
credential wins over `CMD_API_KEY` when both are present, so the env var can
never shadow an account you connected on purpose.

The plugin warns only when **neither** is available — it checks the integration's
active connection, not just the env var, so people who connected through
`/connect` do not get a bogus warning. The provider always registers, so models
stay visible either way.

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

The catalog is **discovered at startup**, cached, and refreshed in the
background — nothing is hardcoded. Each load:

1. reads the catalog cached by an earlier run (or the built-in seed list on a
   cold start) and registers it straight away — no network on the startup path;
2. fetches `GET /provider/v1/models` **in the background** and swaps the list in
   when it lands, caching it for next time;
3. still shows the cached list if that fetch fails.

Verified behaviour:

| Start        | Network | Registered as        | Then                        |
| ------------ | ------- | -------------------- | --------------------------- |
| cold         | up      | `built-in` (4)       | refreshed to 71, cached     |
| warm cache   | up      | `cache` (71)         | refreshed to 71             |
| warm cache   | down    | `cache` (71)         | keeps cached list           |
| cold         | down    | `built-in` (4)       | warns, keeps seed list      |

So the list on screen is the real catalog from the very first request of a run,
and being offline costs freshness, never the list.

Nothing waits on the network because the endpoint is normally quick (~0.2 s) but
has been measured at ~13 s. Gating registration or the first read on it would
either hide the provider or stall the picker for the whole timeout.

The background refresh is forked with `forkScoped`, so a refresh still in flight
is cancelled when the plugin unloads rather than outliving it.

The cache lives in OpenCode's own key/value store (the `kv` table), under the
key `plugin:<plugin id>:catalog`. It holds the **raw API entries**, not the
derived models: `toModel` stays the only code that interprets the API, so an
improved mapping also applies to data written by an older build. A version field
makes older cache shapes be ignored rather than misread.

There is no TTL — a run always refreshes. If refresh keeps failing, the
registered log line reports `source=cache cacheAgeSeconds=...`, which is the
quickest way to tell a healthy cache from a stuck one.

Only models whose `supported_endpoints` include `/chat/completions` are
registered — that is the transport this OpenAI-compatible adapter speaks.
Everything else is omitted rather than offered as a choice that cannot work,
which is how the 9 Claude models (they speak only `/v1/messages`) are excluded
automatically instead of by hand.

Seed list (`src/provider.ts`), used only when the catalog is unreachable:

| Upstream id                  | Context     | Notes                        |
| ---------------------------- | ----------- | ---------------------------- |
| `deepseek/deepseek-v4-flash` | 1,000,000   | Command Code's default model |
| `zai-org/GLM-5.2`            | 1,000,000   | reasoning                    |
| `moonshotai/Kimi-K3`         | 1,000,000   | vision                       |
| `google/gemini-3.7-flash`    | 1,048,576   | vision                       |

`context` comes from the catalog's `context_length`. `output` is **not**
published there, so it stays at the schema default (32,000) rather than being
invented, and `cost` stays empty for the same reason.

### Capabilities

The catalog publishes no capability data, so `tools` is assumed and the rest is
declared by hand. `Model.Info` defaults to claiming image input; the plugin
overrides that to text-only unless the id is listed in `visionModels` in
`src/provider.ts`, so nothing over-promises. Add an id there when a model is
confirmed to accept images.

## What the request looks like

Captured off the wire against a local mock, so this is what the server actually
receives rather than what the code appears to send:

```
POST /provider/v1/chat/completions
{
  "model": "deepseek/deepseek-v4-flash",
  "messages": [...],
  "stream": true,
  "stream_options": { "include_usage": true },
  "store": false,
  "tools": [ /* 12 tools, every one type: "function" */ ]
}
```

All of that matches what the API documents: Chat Completions schema, streaming
with end-of-stream usage (no opt-in needed), and no storage request. `tools` is
absent on turns that use none.

## Zero data retention

ZDR is **opt-in and off by default**:

```jsonc
{
  "plugins": [{ "package": "opencode-connector-cmc", "options": { "zdr": true } }],
}
```

The CLI's variable works too, so an existing setup keeps working, and an explicit
`"zdr": false` overrides it:

| Setting                  | Header sent |
| ------------------------ | ----------- |
| nothing                  | no          |
| `"zdr": true`            | `x-cmd-zdr: 1` |
| `CMD_ZDR=1`              | `x-cmd-zdr: 1` |
| `CMD_ZDR=1` + `"zdr": false` | no      |

All four verified on the wire. The option wins over the environment, matching how
`CMD_API_KEY` is only a fallback elsewhere.

### Why it is not on by default

- Command Code states ~99% of models already run on ZDR upstreams without the
  flag, so turning it on buys little for most traffic.
- It is **strict**: if a model has no ZDR-capable upstream the request fails with
  `422 cmd_zdr_no_providers` instead of being served. That turns working models
  into errors.
- ZDR capacity costs more, and meters at the plan's default allowance rather than
  any boosted allowance, so the same credits buy fewer requests.
- It restricts tools to the ones the client executes itself (`function`,
  `custom`, `local_shell`). OpenCode's tools are all `type: "function"`, so they
  pass — but that is a constraint, not a guarantee.

Anthropic models are ZDR at the account level already, so the header is a no-op
for them.

## Limitations

- **Claude models are not included.** They answer only on `/v1/messages`
  (Anthropic schema), while this provider uses the OpenAI-compatible adapter and
  `/v1/chat/completions`. The catalog reports exactly which 9 these are
  (`supported_endpoints == ["/messages"]`), so a second Anthropic-compatible
  provider entry could be generated from the same data.
- **`/v1/responses` is unused.** OpenAI and open models also answer there, and
  this provider only speaks Chat Completions.
- `typesafe/jev` is a decision model on `/v1/systemone`. It returns
  probabilities instead of text, so it cannot drive a session. It also has no
  ZDR-capable upstream, so it fails under `zdr: true`.
- No `max_tokens`, `temperature`, or `reasoning` is sent. Those are OpenCode's
  per-model choices rather than omissions here.
- Capabilities and pricing are not published by the catalog, so `tools` is
  assumed for every model, vision is declared by hand, and `cost` stays empty.
- Remote `type: "mcp"` tools are rejected by Command Code, which runs them on
  their credential otherwise. Not verified here, because OpenCode executes MCP
  tools itself — but worth knowing if a session ever sends them.

## TODO

- [ ] Send `limit.output` per model once a real number is available
- [ ] Add per-model pricing (`cost`) — the catalog does not publish it
- [ ] Add a second provider entry for Claude via the Anthropic-compatible adapter
- [ ] Stop refreshing on every load once a staleness window (e.g. "refresh if
      older than N hours") is worth the extra state
- [ ] Verify whether every model in the catalog really accepts tools, instead of
      assuming it

## Publish

Publishing is the robust alternative to the absolute path in the global config,
which breaks if this checkout moves.

```sh
bun pm pack
```

Then add to a consuming config:

```jsonc
{
  "plugins": ["opencode-connector-cmc@0.1.0"],
}
```
