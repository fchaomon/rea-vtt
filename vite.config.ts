import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = `http://localhost:${process.env.PORT ?? 3001}`;

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": SERVER,
      "/assets/uploads": SERVER,
      "/ws": { target: SERVER, ws: true },
    },
  },
  test: { root: ".", include: ["shared/**/*.test.ts", "server/**/*.test.ts"] },
} as any);
