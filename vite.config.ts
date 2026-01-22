import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/gamma": {
        target: "https://gamma-api.polymarket.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gamma/, ""),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ["@gear-js/ui", "@gear-js/wallet-connect", "@gear-js/vara-ui", "buffer"],
  },
  define: {
    global: 'globalThis',
  },
  // Remove console.log and console.warn (keeps console.error for real errors)
  esbuild: {
    pure: ['console.log', 'console.warn', 'console.info', 'console.debug'],
  },
}));
