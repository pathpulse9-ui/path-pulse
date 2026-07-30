import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Stellar Wallets Kit pulls in NEAR/Node-flavored deps (randombytes, @near-js)
// that reference `global`, which the browser doesn't have. The define is needed
// both for source transforms and for esbuild's dependency pre-bundling.
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
});
