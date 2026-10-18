import { defineConfig } from "vite";
import { voidPlugin } from "void";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), voidPlugin()],
  server: { host: "127.0.0.1" },
});
