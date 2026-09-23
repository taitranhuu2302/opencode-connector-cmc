import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

import {
  catalogCacheKey,
  catalogURL,
  decodeCatalogCache,
  encodeCatalogCache,
  fetchCatalog,
  resolveZdr,
  providerInfo,
  seedModels,
  providerID,
  apiKeyMissing,
  integrationID,
} from "./provider.js";

export default Plugin.define({
  id: "opencode-connector-cmc",
  effect: (ctx) =>
    Effect.gen(function* () {
      // ZDR is opt-in (`zdr` plugin option, or the CLI's `CMD_ZDR=1`).
      const zdr = resolveZdr(ctx.options);
      const provider = providerInfo(zdr);

      // Serve the best list available right now: the catalog cached by a
      // previous run, or the built-in seed on a cold start. Nothing on this path
      // touches the network, so registering never waits on the API.
      const cached = decodeCatalogCache(
        yield* ctx.storage.get(catalogCacheKey),
      );
      const known = cached?.models ?? seedModels;

      yield* ctx.provider.transform((editor) => {
        editor.add({ info: provider, models: known });
      });

      // Register the integration so the provider shows up in `/connect`.
      // This is what a plugin must do to become connectable; registering a
      // provider alone only adds models, it does not add an entry to `/connect`.
      yield* ctx.integration.transform((editor) => {
        editor.update(integrationID, (item) => {
          item.name = "Command Code";
        });
        editor.method.update({
          integrationID,
          method: { type: "key", label: "API key" },
        });
        // Matches how built-in integrations expose an env fallback.
        editor.method.update({
          integrationID,
          method: { type: "env", names: ["CMD_API_KEY"] },
        });
      });

      yield* Effect.logInfo("Command Code provider registered", {
        providerID: provider.id,
        models: known.length,
        source: cached ? "cache" : "built-in",
        // Whether the ZDR header is on changes cost, tool acceptance, and which
        // models can answer at all, so it belongs in the startup record.
        zdr,
        // Age is what distinguishes "cache is fine" from "refresh keeps failing"
        // when someone reports a stale list.
        ...(cached && cached.fetchedAt > 0
          ? {
              cacheAgeSeconds: Math.round(
                (Date.now() - cached.fetchedAt) / 1000,
              ),
            }
          : {}),
      });

      // Refresh in the background and swap in the result when it lands.
      // `forkScoped` attaches the fiber to the plugin's scope, so a refresh in
      // flight is cancelled on unload instead of outliving the plugin. Startup
      // does not wait for it: the endpoint is usually quick (~0.2s) but has been
      // measured at ~13s, and awaiting that would stall plugin load.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const catalog = yield* fetchCatalog;

          if (!catalog) {
            // With a cache in hand this is a missed refresh, not a failure —
            // the list on screen is still the real catalog, just not the newest.
            if (cached) {
              yield* Effect.logInfo(
                `Could not refresh the model catalog from ${catalogURL}; ` +
                  "keeping the cached list.",
              );
            } else {
              yield* Effect.logWarning(
                `Could not load the model catalog from ${catalogURL} — ` +
                  `keeping the ${seedModels.length} built-in models.`,
              );
            }
            return;
          }

          // Only cache what was actually applied, so storage never claims a
          // catalog this process did not use.
          yield* ctx.provider.transform((editor) => {
            editor.models.set(providerID, catalog.models);
          });
          yield* ctx.storage.set(
            catalogCacheKey,
            encodeCatalogCache(catalog, Date.now()),
          );

          yield* Effect.logInfo("Command Code catalog refreshed", {
            models: catalog.models.length,
            replaced: known.length,
          });
        }),
      );

      // A credential can arrive two ways: stored by `/connect`, or read from the
      // `CMD_API_KEY` env fallback. Only warn when BOTH are missing — keying the
      // warning off the env var alone is wrong for anyone who connected through
      // `/connect`, which is the preferred path.
      const connection =
        yield* ctx.integration.connection.active(integrationID);
      if (!connection && apiKeyMissing) {
        yield* Effect.logWarning(
          "Could not find a Command Code credential — requests will fail with " +
            "401. Run /connect and choose Command Code, or export CMD_API_KEY " +
            "before starting OpenCode.",
        );
      }

      // Release the registration (and anything else scoped here) on unload.
      yield* Effect.addFinalizer(() =>
        Effect.logInfo("Command Code provider unregistered"),
      );
    }),
});
