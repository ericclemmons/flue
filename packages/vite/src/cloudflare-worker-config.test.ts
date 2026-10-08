import { describe, expect, it } from 'vitest';
import {
	flueWorkerConfig,
	registerFlueWorkerConfigSource,
	type FlueWorkerConfigSource,
} from './cloudflare-worker-config.ts';

function customizer(overrides: Partial<FlueWorkerConfigSource> = {}) {
	const source: FlueWorkerConfigSource = {
		configReady: true,
		isPreview: false,
		doBindings: [{ name: 'FLUE_ECHO_AGENT', class_name: 'FlueEchoAgent' }],
		customizerInvoked: false,
		...overrides,
	};
	registerFlueWorkerConfigSource(source);

	return flueWorkerConfig();
}

describe('Flue Worker config customizer', () => {
	it('adds native fields without changing user bindings or export lifecycle', () => {
		const exports = {
			FlueEchoAgent: { type: 'durable-object', storage: 'sqlite' },
			RetiredAgent: { type: 'durable-object', state: 'deleted' },
		};
		const config = {
			name: 'example',
			compatibilityDate: '2026-10-01',
			compatibilityFlags: ['some_flag'],
			env: { MESSAGE: { type: 'text', value: 'hello' } },
			exports,
		};
		const apply = customizer();
		apply(config);
		apply(config);
		expect(config).toEqual({
			name: 'example',
			compatibilityDate: '2026-10-01',
			compatibilityFlags: ['some_flag', 'nodejs_compat'],
			entrypoint: 'virtual:flue/worker',
			env: {
				MESSAGE: { type: 'text', value: 'hello' },
				FLUE_ECHO_AGENT: { type: 'durable-object', worker: 'example', exportName: 'FlueEchoAgent' },
			},
			exports,
		});
		expect(config.exports).toBe(exports);
	});

	it('preserves authored native entries and matching local bindings', () => {
		const binding = { type: 'durable-object', worker: 'example', exportName: 'FlueEchoAgent' };
		const config = {
			name: 'example',
			compatibilityDate: '2026-10-01',
			entrypoint: './src/worker.ts',
			env: { FLUE_ECHO_AGENT: binding },
		};
		customizer()(config);
		expect(config.entrypoint).toBe('./src/worker.ts');
		expect(config.env.FLUE_ECHO_AGENT).toBe(binding);
	});

	it.each([
		{ type: 'text', value: 'wrong type' },
		{ type: 'durable-object', worker: 'another-worker', exportName: 'FlueEchoAgent' },
		{ type: 'durable-object', worker: 'example', exportName: 'AnotherAgent' },
	])('rejects conflicting native binding %j', (binding) => {
		expect(() =>
			customizer()({
				name: 'example',
				compatibilityDate: '2026-10-01',
				env: { FLUE_ECHO_AGENT: binding },
			}),
		).toThrow('reserved by Flue');
	});

	it.each(['compatibilityDate', 'compatibility_date'])(
		'keeps the compatibility-date floor for %s',
		(field) => {
			expect(() => customizer()({ [field]: '2026-03-31' })).toThrow('requires at least');
		},
	);

	it('keeps the Wrangler schema and migration history', () => {
		const migrations = [{ tag: 'v1', new_sqlite_classes: ['FlueEchoAgent'] }];
		const config = { compatibility_date: '2026-10-01', migrations };
		customizer()(config);
		expect(config).toEqual({
			compatibility_date: '2026-10-01',
			compatibility_flags: ['nodejs_compat'],
			main: 'virtual:flue/worker',
			durable_objects: { bindings: [{ name: 'FLUE_ECHO_AGENT', class_name: 'FlueEchoAgent' }] },
			migrations,
		});
		expect(config.migrations).toBe(migrations);
	});

	it('leaves preview artifacts untouched', () => {
		const config = { compatibilityDate: '2026-03-31', entrypoint: './index.js' };
		customizer({ isPreview: true })(config);
		expect(config).toEqual({ compatibilityDate: '2026-03-31', entrypoint: './index.js' });
	});

	it('still rejects missing or early Flue configuration', () => {
		expect(() => customizer({ configReady: false })({})).toThrow('ran before flue()');
		expect(() => flueWorkerConfig()).toThrow('was called before flue()');
	});
});
