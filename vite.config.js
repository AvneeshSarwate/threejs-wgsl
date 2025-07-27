import { defineConfig } from "vite";

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
    sourcemap: true,
    rollupOptions: {
      external: ['agent_examples/**']
    }
  },
  optimizeDeps: {
    exclude: ['agent_examples'],
    entries: ['src/**/*.ts', 'src/**/*.js', 'index.html']
  },
  define: {
    __DEV__: true
  },
  esbuild: {
    sourcemap: true,
    keepNames: true
  }
});
