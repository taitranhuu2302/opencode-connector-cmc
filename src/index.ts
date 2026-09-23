import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

import { models, apiKeyMissing, provider } from "./provider.js";

export default Plugin.define({
  id: "opencode-connector-cmc",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.provider.transform((editor) => {
        editor.add({ info: provider, models });
      });

      yield* Effect.logInfo("Command Code provider registered", {
        providerID: provider.id,
        models: models.length,
      });

      // Still register the provider so models are visible, but say why requests
      // will be rejected instead of leaving a bare 401 to figure out.
      if (apiKeyMissing) {
        yield* Effect.logWarning(
          "CMD_API_KEY is not set — Command Code requests will fail with 401. " +
            "Export CMD_API_KEY and restart OpenCode.",
        );
      }

      // Release the registration (and anything else scoped here) on unload.
      yield* Effect.addFinalizer(() =>
        Effect.logInfo("Command Code provider unregistered"),
      );
    }),
});
