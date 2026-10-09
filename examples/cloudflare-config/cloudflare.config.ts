import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'flue-cloudflare-config',
		compatibilityDate: '2026-06-01',
		env: { AI: bindings.ai() },
		exports: {
			FlueWithCloudflareBindingAgent: exports.durableObject({ storage: 'sqlite' }),
		},
	},
});
