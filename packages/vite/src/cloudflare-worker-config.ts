/**
 * Flue's Cloudflare worker configuration — the `flueWorkerConfig()`
 * customizer the user passes to the sibling `@cloudflare/vite-plugin`:
 *
 * ```ts
 * // vite.config.ts
 * import { cloudflare } from '@cloudflare/vite-plugin';
 * import { flue, flueWorkerConfig } from '@flue/vite';
 * export default defineConfig({
 *   plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
 * });
 * ```
 *
 * The sibling plugin owns config loading and build output. Version 1 reads
 * `wrangler.jsonc`; version 2 reads `cloudflare.config.ts` and invokes the
 * same customizer with the native Worker schema. Flue never reads or writes
 * either configuration file. The customizer
 * contributes only what Flue derives at config-resolution time:
 *
 *   - `main` / `entrypoint` → `virtual:flue/worker`, the generated Worker
 *     entry (left alone when the user set their own entry);
 *   - one Durable Object binding per scanned `'use agent'` agent;
 *   - the `nodejs_compat` compatibility flag (unioned in);
 *   - validation of a user-set `compatibility_date` against Flue's floor.
 *
 * Everything else — user Durable Object bindings, containers, R2 buckets,
 * and the complete migration history — belongs to the user's own
 * config and passes through untouched. Migration history (Wrangler) or the
 * `exports` lifecycle map (native config) remains user-owned.
 *
 * Linkage: `vite.config.ts` is re-evaluated per Vite config resolution, so
 * `flue()` and `flueWorkerConfig()` are fresh instances each resolution.
 * `flue()` registers its state synchronously at creation;
 * `flueWorkerConfig()` captures that state at creation. The customizer runs
 * inside the sibling's `config` hook — after flue's, which is why `flue()`
 * must precede `cloudflare()` in the plugin array — and reads the completed
 * agent scan from the captured state. Because each customizer is bound to
 * its own `flue()` instance, concurrent Vite servers in one process never
 * cross-talk.
 */
import { stackless } from './diagnostics.ts';

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_COMPATIBILITY_DATE = '2026-04-01';

/** compatibility_flag Flue requires for pi-ai's process.env-based API key lookup. */
const REQUIRED_COMPAT_FLAG = 'nodejs_compat';

/** The virtual Worker entry `main` points at (served by the flue() plugin). */
export const VIRTUAL_WORKER_ENTRY = 'virtual:flue/worker';

// ─── State linkage ──────────────────────────────────────────────────────────

/** A Flue-owned generated DO binding. */
interface FlueDoBinding {
	readonly name: string;
	readonly class_name: string;
}

/**
 * The narrow view of `flue()`'s plugin state the customizer needs. The
 * `flue()` config hook keeps these current; the customizer reads them and
 * reports back through `customizerInvoked`.
 */
export interface FlueWorkerConfigSource {
	/** True once flue()'s `config` hook has resolved the project for this resolution. */
	configReady: boolean;
	/** Preview serves built artifacts; the customizer must not touch the config. */
	isPreview: boolean;
	/** The scanned per-agent Durable Object bindings. */
	readonly doBindings: readonly FlueDoBinding[];
	/** Set by the customizer so `configResolved` can diagnose missing wiring. */
	customizerInvoked: boolean;
}

let latestSource: FlueWorkerConfigSource | undefined;

/** Called synchronously by `flue()` at plugin creation. */
export function registerFlueWorkerConfigSource(source: FlueWorkerConfigSource): void {
	latestSource = source;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Flue's worker-config customizer, compatible with the sibling plugin's
 * `cloudflare({ config })` option. The parameter is typed structurally
 * (`object`) because `@flue/vite` deliberately has no dependency on
 * `@cloudflare/vite-plugin`; the sibling passes its resolved `WorkerConfig`.
 */
export type FlueWorkerConfigCustomizer = (config: object) => void;

/**
 * Create the worker-config customizer for the `flue()` instance created in
 * the same `vite.config.ts` evaluation. Must be called after `flue()`.
 */
export function flueWorkerConfig(): FlueWorkerConfigCustomizer {
	// One-shot capture: consuming the slot means a flueWorkerConfig() created
	// before its flue() always hits the clear error below — even in a warm
	// process where a previous resolution's registration would otherwise
	// linger in the module scope and be captured silently.
	const source = latestSource;
	latestSource = undefined;
	if (!source) {
		throw stackless(
			new Error(
				'[flue] flueWorkerConfig() was called before flue(). Create the flue() plugin first ' +
					'in the same Vite config:\n\n' +
					'  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })]\n',
			),
		);
	}
	return (config: object) => {
		source.customizerInvoked = true;
		// Preview serves the already-built Worker output; its config is the
		// emitted deploy config and must pass through untouched.
		if (source.isPreview) return;
		if (!source.configReady) {
			// The linked flue() never took the Cloudflare config path in this
			// resolution — its hook hasn't run yet (plugin ordering), or it
			// configured the Node target (explicit `target: 'node'`, or the
			// cloudflare() plugin was not visible as a plain plugins entry).
			throw stackless(
				new Error(
					'[flue] flueWorkerConfig() ran before flue() configured the Cloudflare target. ' +
						'Ensure flue() precedes cloudflare() as plain entries of the same `plugins` array ' +
						"(not wrapped in a Promise or added by another plugin), and that flue's `target` " +
						"is not forced to 'node':\n\n" +
						'  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })]\n',
				),
			);
		}
		applyFlueWorkerConfig(config as Record<string, unknown>, source.doBindings);
	};
}

/**
 * Diagnostic shared with the plugin's own ordering checks: the customizer
 * runs inside the sibling's `config` hook, so flue's hook (project
 * resolution + agent scan) must have run first.
 */
export function cloudflareOrderingError(): Error {
	return stackless(
		new Error(
			'[flue] flue() must come before cloudflare() in the Vite plugins array. ' +
				'The Cloudflare plugin invokes flueWorkerConfig() while Vite resolves the config, and ' +
				'flue() must have scanned the project first. Reorder:\n\n' +
				'  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })]\n',
		),
	);
}

// ─── Customizer body ────────────────────────────────────────────────────────

/**
 * Mutate the sibling's resolved Worker config in place. The sibling loads
 * the authored config for the active environment or mode before invoking
 * the customizer, so every contribution lands in the effective config.
 */
function applyFlueWorkerConfig(
	config: Record<string, unknown>,
	doBindings: readonly FlueDoBinding[],
): void {
	const native = 'compatibilityDate' in config;
	validateCompatibilityDate(config, native ? 'compatibilityDate' : 'compatibility_date');

	// compatibility_flags: union in nodejs_compat. The deploy artifact is the
	// sibling-emitted merged config, so the union is always effective; the
	// user's authored file no longer needs to carry the flag itself.
	const flagsField = native ? 'compatibilityFlags' : 'compatibility_flags';
	const flags = Array.isArray(config[flagsField])
		? (config[flagsField] as unknown[]).filter((flag): flag is string => typeof flag === 'string')
		: [];

	if (!flags.includes(REQUIRED_COMPAT_FLAG)) flags.push(REQUIRED_COMPAT_FLAG);
	config[flagsField] = flags;

	// main: default to the generated virtual Worker entry. A user-set main is
	// respected — it owns the Worker entry and can re-export the generated
	// module (`export * from 'virtual:flue/worker'` for the Durable Object
	// classes) while composing its own default handler.
	const entryField = native ? 'entrypoint' : 'main';

	if (typeof config[entryField] !== 'string' || config[entryField].length === 0) {
		config[entryField] = VIRTUAL_WORKER_ENTRY;
	}

	if (native) {
		mergeNativeDurableObjectBindings(config, doBindings);
	} else {
		mergeDurableObjectBindings(config, doBindings);
	}

	// compatibility_date and name are left to the sibling's own defaults when
	// unset (its date default tracks the workerd version it bundles, which is
	// strictly better than a Flue-pinned floor). containers, migrations, and
	// every other field pass through untouched.
}

/**
 * Enforce Flue's compatibility_date floor on a user-set value. We're
 * intentionally strict rather than silently bumping the date — the failure
 * modes of an old date (missing SQLite DO support, nodejs_compat v2,
 * AsyncLocalStorage) produce confusing runtime errors, and a user pins a
 * date deliberately.
 */
function validateCompatibilityDate(config: Record<string, unknown>, field: string): void {
	const userDate = config[field];

	if (typeof userDate !== 'string') return;

	if (!/^\d{4}-\d{2}-\d{2}$/.test(userDate)) {
		throw stackless(
			new Error(
				`[flue] Your Cloudflare config's "${field}" ("${userDate}") is not in YYYY-MM-DD format.`,
			),
		);
	}

	if (userDate < MIN_COMPATIBILITY_DATE) {
		throw stackless(
			new Error(
				`[flue] Your Cloudflare config's "${field}" is "${userDate}". ` +
					`Flue requires at least "${MIN_COMPATIBILITY_DATE}" for SQLite-backed Durable Object support, nodejs_compat v2, and AsyncLocalStorage. ` +
					`Bump the date (set it to today unless you have a specific reason).`,
			),
		);
	}
}

function mergeNativeDurableObjectBindings(
	config: Record<string, unknown>,
	doBindings: readonly FlueDoBinding[],
): void {
	const env = { ...(config.env as Record<string, unknown> | undefined) };

	for (const binding of doBindings) {
		const existing = env[binding.name];

		if (existing !== undefined) {
			if (
				typeof existing !== 'object' ||
				existing === null ||
				!('type' in existing) ||
				existing.type !== 'durable-object' ||
				!('exportName' in existing) ||
				existing.exportName !== binding.class_name ||
				!('worker' in existing) ||
				existing.worker !== config.name
			) {
				throw stackless(
					new Error(
						`[flue] cloudflare.config.ts env binding "${binding.name}" is reserved by Flue. ` +
							`Expected a durable-object binding to "${binding.class_name}" in Worker "${config.name}".`,
					),
				);
			}
		} else {
			env[binding.name] = {
				type: 'durable-object',
				worker: config.name,
				exportName: binding.class_name,
			};
		}
	}
	config.env = env;
}

/**
 * Add Flue's generated per-agent DO bindings, validating that any user
 * binding occupying a Flue-reserved name is exactly the binding Flue would
 * generate (harmless duplication) rather than a conflicting redirection.
 */
function mergeDurableObjectBindings(
	config: Record<string, unknown>,
	doBindings: readonly FlueDoBinding[],
): void {
	const existingDo =
		typeof config.durable_objects === 'object' && config.durable_objects !== null
			? (config.durable_objects as Record<string, unknown>)
			: {};
	const existingBindings = Array.isArray(existingDo.bindings)
		? (existingDo.bindings as unknown[]).filter(
				(b): b is Record<string, unknown> => typeof b === 'object' && b !== null,
			)
		: [];
	const existingByName = new Map(
		existingBindings.filter((b) => typeof b.name === 'string').map((b) => [b.name as string, b]),
	);
	for (const binding of doBindings) {
		const existing = existingByName.get(binding.name);
		if (!existing) continue;
		if (
			existing.class_name !== binding.class_name ||
			existing.script_name !== undefined ||
			existing.environment !== undefined
		) {
			throw stackless(
				new Error(
					`[flue] wrangler config durable object binding "${binding.name}" is reserved by Flue. ` +
						`Expected a local class_name "${binding.class_name}" binding without script_name or environment.`,
				),
			);
		}
	}
	const bindingsToAdd = doBindings
		.filter((binding) => !existingByName.has(binding.name))
		.map((binding) => ({ name: binding.name, class_name: binding.class_name }));
	config.durable_objects = {
		...existingDo,
		bindings: [...existingBindings, ...bindingsToAdd],
	};
}
