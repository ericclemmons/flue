import { cloudflare } from '@cloudflare/vite-plugin-wrangler';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [flue(), cloudflare({ config: flueWorkerConfig(), remoteBindings: false })],
});
