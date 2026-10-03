import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    // main.js bundles ../web/sample-import.json so both apps share one import example.
    fs: { allow: ['..'] }
  }
});
