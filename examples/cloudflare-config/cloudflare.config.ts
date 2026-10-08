import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'flue-cloudflare-config',
		compatibilityDate: '2026-10-01',
		env: { MESSAGE: bindings.text('hello') },
		exports: { FlueEchoAgent: exports.durableObject({ storage: 'sqlite' }) },
	},
});
