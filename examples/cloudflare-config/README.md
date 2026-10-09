# Cloudflare programmatic configuration

The Workers AI agent from [the Wrangler example](../cloudflare), configured with
`cloudflare.config.ts` and `flueNativeWorkerConfig()`.

Flue contributes the generated Worker entry, `nodejs_compat`, and agent bindings.
The app owns its Workers AI binding and Durable Object lifecycle in
`cloudflare.config.ts`. Keep `flue()` before `cloudflare()` in the Vite plugins array.

This example pins the native-config Vite plugin beta; the stable plugin's
`experimental.newConfig` path does not accept a config customizer.

From the repository root:

```sh
pnpm install
pnpm --filter @flue/runtime --filter @flue/vite run build
pnpm --filter cloudflare-config dev
```

The app exposes `/api/ping` and `/agents/with-cloudflare-binding`.
Workers AI requests require Cloudflare authentication; no provider API key is needed.
Run `pnpm --filter cloudflare-config build` to build, or
`pnpm --filter cloudflare-config deploy` to deploy that build with `cf`.
