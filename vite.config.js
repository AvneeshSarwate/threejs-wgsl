import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  resolve: {
    alias: {
      'three/addons': 'three/examples/jsm'
    }
  },
  server: {
    fs: {
      deny: ['**/agent_examples/**']
    }
  },
  build: {
    rollupOptions: {
      external: ['agent_examples/**']
    }
  },
  optimizeDeps: {
    exclude: ['agent_examples'],
    entries: ['src/**/*.ts', 'src/**/*.js', 'index.html']
  }
});
