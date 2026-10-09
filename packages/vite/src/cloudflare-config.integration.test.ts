import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { cloudflare as nativeCloudflare } from '@cloudflare/vite-plugin-native';
import { createBuilder, createServer, type InlineConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { flueNativeWorkerConfig, flueWorkerConfig } from './cloudflare-worker-config.ts';
import { flue } from './flue-plugin.ts';

async function withCloudflareFixture(run: (root: string) => Promise<void>): Promise<void> {
	const fixtures = fileURLToPath(new URL('../test/.tmp/', import.meta.url));
	await fs.mkdir(fixtures, { recursive: true });
	const root = await fs.mkdtemp(path.join(fixtures, 'cloudflare-config-'));
	try {
		await fs.mkdir(path.join(root, 'src/agents'), { recursive: true });
		await fs.writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({
				name: 'flue-cloudflare-config',
				private: true,
				type: 'module',
			}),
		);
		await fs.writeFile(
			path.join(root, 'src/agents/echo.ts'),
			"'use agent';\nexport function Echo() { return 'Echo the message.'; }\n",
		);
		await fs.writeFile(
			path.join(root, 'src/app.ts'),
			[
				"import { createAgentRouter } from '@flue/runtime/routing';",
				"import { Hono } from 'hono';",
				"import { Echo } from './agents/echo.ts';",
				'const app = new Hono<{ Bindings: { MESSAGE: string } }>();',
				"app.get('/', (context) => context.text(context.env.MESSAGE));",
				"app.route('/agents/echo', createAgentRouter(Echo));",
				'export default app;',
			].join('\n'),
		);
		await fs.writeFile(
			path.join(root, 'cloudflare.config.ts'),
			[
				"import { bindings, defineConfig, exports } from '@cloudflare/config/public';",
				'export default defineConfig({ worker: {',
				"name: 'flue-cloudflare-config', compatibilityDate: '2026-09-28',",
				"env: { MESSAGE: bindings.text('hello') },",
				"exports: { FlueEchoAgent: exports.durableObject({ storage: 'sqlite' }) },",
				'} });',
			].join('\n'),
		);
		await fs.writeFile(
			path.join(root, 'wrangler.jsonc'),
			JSON.stringify({
				name: 'flue-cloudflare-config',
				compatibility_date: '2026-09-28',
				vars: { MESSAGE: 'hello' },
				migrations: [{ tag: 'v1', new_sqlite_classes: ['FlueEchoAgent'] }],
			}),
		);
		await run(root);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

function viteConfig(root: string, native: boolean): InlineConfig {
	return {
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [
			flue(),
			native
				? nativeCloudflare({ config: flueNativeWorkerConfig(), remoteBindings: false })
				: cloudflare({ config: flueWorkerConfig(), remoteBindings: false }),
		],
	};
}

describe.sequential('Cloudflare configuration integration', () => {
	it('reports the unsupported stable-plugin newConfig/customizer combination', async () => {
		await withCloudflareFixture(async (root) => {
			await expect(
				createBuilder({
					root,
					configFile: false,
					logLevel: 'silent',
					plugins: [
						flue(),
						cloudflare({ config: flueWorkerConfig(), experimental: { newConfig: true } }),
					],
				}),
			).rejects.toThrow('`config` cannot be used together with `experimental.newConfig`');
		});
	});

	it('does not bypass Flue validation when the stable customizer is removed', async () => {
		await withCloudflareFixture(async (root) => {
			await expect(
				createBuilder({
					root,
					configFile: false,
					logLevel: 'silent',
					plugins: [flue(), cloudflare({ experimental: { newConfig: true } })],
				}),
			).rejects.toThrow("not receiving Flue's Worker configuration");
		});
	});

	it('builds a native Worker with the generated entry and agent binding', async () => {
		await withCloudflareFixture(async (root) => {
			await (await createBuilder(viteConfig(root, true))).buildApp();
			const output = path.join(root, '.cloudflare/output/v0/workers/default');
			const config = JSON.parse(await fs.readFile(path.join(output, 'worker.config.json'), 'utf8'));
			expect(config.manifest.mainModule).toBe('index.js');
			expect(config.compatibilityFlags).toContain('nodejs_compat');
			expect(config.env.FLUE_ECHO_AGENT).toEqual({
				type: 'durable-object',
				worker: 'flue-cloudflare-config',
				exportName: 'FlueEchoAgent',
			});
			expect(config.env.MESSAGE).toEqual({ type: 'text', value: 'hello' });
			expect(config.exports.FlueEchoAgent).toEqual({ type: 'durable-object', storage: 'sqlite' });
			expect(await fs.readFile(path.join(output, 'bundle/index.js'), 'utf8')).toContain(
				'FlueEchoAgent',
			);
		});
	}, 60_000);

	it('retains the Wrangler customizer path', async () => {
		await withCloudflareFixture(async (root) => {
			await (await createBuilder(viteConfig(root, false))).buildApp();
			const output = path.join(root, 'dist/flue_cloudflare_config');
			const config = JSON.parse(await fs.readFile(path.join(output, 'wrangler.json'), 'utf8'));
			expect(config.main).toBe('index.js');
			expect(config.compatibility_flags).toContain('nodejs_compat');
			expect(config.durable_objects.bindings).toContainEqual({
				name: 'FLUE_ECHO_AGENT',
				class_name: 'FlueEchoAgent',
			});
			expect(config.vars.MESSAGE).toBe('hello');
			expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['FlueEchoAgent'] }]);
			expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toContain('FlueEchoAgent');
		});
	}, 60_000);

	it.each([true, false])(
		'serves the Worker and agent locally (native: %s)',
		async (native) => {
			await withCloudflareFixture(async (root) => {
				const server = await createServer({
					...viteConfig(root, native),
					server: { host: '127.0.0.1', port: 0 },
				});
				try {
					await server.listen();
					const [url] = server.resolvedUrls?.local ?? [];
					if (!url) throw new Error('Vite did not expose a local server URL');
					expect(await (await fetch(url)).text()).toBe('hello');
					const response = await fetch(new URL('/agents/echo/local-check/abort', url), {
						method: 'POST',
					});
					expect(response.status).toBe(200);
				} finally {
					await server.close();
				}
			});
		},
		60_000,
	);
});
