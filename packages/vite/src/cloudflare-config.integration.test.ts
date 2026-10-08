import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { createBuilder } from 'vite';
import { describe, expect, it } from 'vitest';
import { flueWorkerConfig } from './cloudflare-worker-config.ts';
import { flue } from './flue-plugin.ts';

const root = fileURLToPath(new URL('../../../examples/cloudflare-config', import.meta.url));

describe.sequential('Cloudflare configuration integration', () => {
	it('reports the unsupported stable-plugin newConfig/customizer combination', async () => {
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

	it('builds a native Worker with the generated entry and agent binding', async () => {
		await (await createBuilder({ root, logLevel: 'silent' })).buildApp();
		const manifest = JSON.parse(
			await fs.readFile(path.join(root, '.cloudflare/output/v0/manifest.json'), 'utf8'),
		);
		expect(manifest).toBeDefined();
	}, 60_000);

	it('retains the Wrangler customizer path', async () => {
		await (await createBuilder({
			root,
			configFile: path.join(root, 'vite.config.wrangler.ts'),
			logLevel: 'silent',
		})).buildApp();
		const config = JSON.parse(
			await fs.readFile(path.join(root, 'dist/flue_cloudflare_config/wrangler.json'), 'utf8'),
		);
		expect(config.main).toBe('index.js');
		expect(config.compatibility_flags).toContain('nodejs_compat');
		expect(config.durable_objects.bindings).toContainEqual({
			name: 'FLUE_ECHO_AGENT',
			class_name: 'FlueEchoAgent',
		});
	}, 60_000);
});
