import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Fail the build instead of shipping a site that silently calls localhost.
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && !env.VITE_API_URL) {
    throw new Error("VITE_API_URL is not set. Point it at your backend URL before building.");
  }
  return {
    plugins: [react(), tailwindcss()],
    test: { environment: "node" },
  };
});
