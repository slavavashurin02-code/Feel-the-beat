import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true — сайт доступен не только на localhost, но и по IP ноутбука в вашей Wi-Fi сети
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
