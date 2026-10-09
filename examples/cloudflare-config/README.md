# Flue with `cloudflare.config.ts`

A credential-free example of Flue's generated Worker entry and agent Durable Object binding.
`GET /` returns the authored `MESSAGE` binding. Aborting an idle agent instance exercises its
local SQLite-backed Durable Object without calling an AI provider. The `Echo` agent is a scan
fixture, not a configured model: sending it a prompt requires adding a model/provider.

## Versions and API boundary

| Path     | Cloudflare Vite plugin       | Configuration                                       |
| -------- | ---------------------------- | --------------------------------------------------- |
| Native   | `2.0.0-beta.sha-52b0dc0e9`   | `cloudflare.config.ts`, camelCase Worker customizer |
| Wrangler | `1.58.0`, Wrangler `4.137.0` | `wrangler.jsonc`, existing snake_case customizer    |

Both use Vite `8.1.5` and the workspace `@flue/vite` `2.2.2`; native configuration uses
`cf` `1.0.0-beta.12`. These versions are pinned in the example and lockfile. Native config is
beta; this example does not promise that an arbitrary future beta has the same contract.

Version `1.58.0` rejects `config` together with `experimental.newConfig: true`. Removing
`flueWorkerConfig()` is not a fix: Flue still needs its generated entry and bindings, and its
missing-customizer diagnostic remains enabled. Version 2 supplies a supported customizer for
native Worker configuration. Select its typed customizer explicitly:

```ts
plugins: [flue(), cloudflare({ config: flueNativeWorkerConfig(), remoteBindings: false })];
```

`flueNativeWorkerConfig()` receives Cloudflare's schema-derived `ParsedInputWorkerConfig`;
`flueWorkerConfig()` retains Wrangler's resolved field types. Neither adapter guesses the schema
from object properties or casts bindings to an untyped dictionary. The native adapter supplies
`entrypoint`, `compatibilityFlags`, and `env` Durable Object bindings instead of Wrangler's
`main`, `compatibility_flags`, and `durable_objects`. An authored entry wins; reserved binding
collisions and old compatibility dates still fail. Native `exports` lifecycle declarations
and Wrangler migration history remain user-owned and unchanged. Config loading, schema
validation, bundling, and local runtime startup remain Cloudflare's responsibility. Its plugin
parses the native schema before and after the callback; Flue checks only its compatibility-date
floor/format and ownership of reserved agent bindings. The binding `type` check narrows
Cloudflare's discriminated union, not an unknown object. `@cloudflare/config` is pinned to the
native plugin's `0.22.0` schema; Wrangler is an optional peer so Node-only apps do not install it.

## Run locally

From the repository root:

```sh
pnpm --filter cloudflare-config --filter @flue/vite... install --frozen-lockfile
pnpm --filter @flue/runtime --filter @flue/vite run build
pnpm --filter cloudflare-config build
pnpm --filter cloudflare-config build:wrangler
pnpm --filter @flue/vite exec vitest run src/cloudflare-worker-config.test.ts src/cloudflare-config.integration.test.ts --no-file-parallelism
pnpm --filter cloudflare-config dev
```

The integration tests inspect both emitted Worker configurations and bundles, then start each
local workerd server, fetch `/`, abort an idle agent instance, and close the server in `finally`.
No account, API token, AI key, upload, or deployment is required. The compatibility date is
within both pinned runtimes' supported range. Native builds may print a Docker-daemon probe
warning even with no Containers configured; these tests do not require Docker.

## Red–green–refactor

At red commit `e6e6c03b`, after installing dependencies and building the workspace packages:

```sh
pnpm --filter @flue/vite exec vitest run src/cloudflare-config.integration.test.ts --no-file-parallelism
```

Result: **one failure, two passes**. The native callback fails Cloudflare's real schema
validation with `Unrecognized keys: "compatibility_flags", "main", "durable_objects"`.
The stable API-boundary check and Wrangler build pass. `pnpm --filter cloudflare-config build`
fails for the same schema reason.

At green commit `61883754`, rebuilding `@flue/vite` and repeating that test command gives
**three passes**. The adapter writes native fields through the supported callback while
retaining the Wrangler path. The final refactor shares date/flag/entry handling, keeps
schema-specific binding merges separate, and adds collision/preservation and local-runtime checks.
The review revision replaces the initially untyped adapter with separate native and Wrangler
callbacks, carrying the upstream types through the captured-state wrapper and binding merges.

## Call diff

Baseline: upstream `65832594` (`@flue/vite` `2.2.2`), September 28, 2026. Changes are implemented
on this fork branch, not landed upstream. No proposed Cloudflare API is required.

```diff
 Vite config: flue() → registerFlueWorkerConfigSource(source)
- Vite config: flueWorkerConfig(): (config: object) => void → capture that source
+ Wrangler: flueWorkerConfig(): (config: WranglerWorkerConfig) => void → capture that source
+ Native: flueNativeWorkerConfig(): (config: ParsedInputWorkerConfig) => void → capture that source
 flue.config(): load project → scanAgents() → source.configReady = true
 cloudflare.config(): load authored config
+  native → InputWorkerSchema.parse() → flueNativeWorkerConfig()(config)
+  Wrangler → normalized Wrangler config → flueWorkerConfig()(config)
-  applyFlueWorkerConfig(config: Record<string, unknown>, bindings): write Wrangler fields
+  native → applyNativeWorkerConfig(config: ParsedInputWorkerConfig, bindings)
+    mergeNativeDurableObjectBindings(): narrow binding.type → validate owner/class → worker.env
+  Wrangler → applyWranglerWorkerConfig(config: WranglerWorkerConfig, bindings)
     mergeDurableObjectBindings(): validate owner/class → durable_objects
 flue.configResolved(): require customizerInvoked (except artifact preview)
 flue.resolveId()/load(): virtual:flue/worker → generateCloudflareEntry()
 Cloudflare: validate customized configuration → bundle generated entry → emit build output
```

Pairing, ordering, compatibility-date, and binding-collision errors still stop config resolution.
Cloudflare owns schema parsing; Flue owns generated entries, agent bindings, and their callback
pairing. Explicit schema-specific entry points replace the rejected property-based detection.
Preview customizers leave built artifacts untouched. Test-owned servers close on success or failure.

## Sources

- [Flue contribution policy](https://github.com/withastro/flue/blob/65832594/CONTRIBUTING.md),
  withastro, updated September 15, 2026: external PRs are not accepted; this change stays in a personal fork.
- [Existing Flue customizer](https://github.com/withastro/flue/blob/65832594/packages/vite/src/cloudflare-worker-config.ts):
  prior art for per-resolution state, entry defaults, compatibility validation, and reserved names.
- [Cloudflare programmatic config](https://developers.cloudflare.com/cf/projects/cloudflare-config/),
  Cloudflare, updated September 29, 2026: authored Worker configuration and export lifecycle ownership.
- [Pinned native customizer implementation](https://github.com/cloudflare/workers-sdk/blob/52b0dc0e99b5bbdb86c06ed53fb703048efc36cf/packages/vite-plugin-cloudflare/src/plugin-config.ts),
  Cloudflare, October 1, 2026: the supported v2 callback runs before native schema validation.

The implementation follows the pinned source contracts rather than mixing the stable v1
customizer with its incompatible experimental native loader. No Cloudflare package is patched,
no validation is bypassed, and no generated configuration file is authored by Flue.
