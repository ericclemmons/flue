import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'flue-cloudflare-config',
		compatibilityDate: '2026-09-28',
		env: { MESSAGE: bindings.text('hello') },
		exports: { FlueEchoAgent: exports.durableObject({ storage: 'sqlite' }) },
	},
});
