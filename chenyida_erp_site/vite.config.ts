import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  server: process.env.CODEX_SANDBOX === "seatbelt" ? { watch: { usePolling: true } } : undefined,
});
