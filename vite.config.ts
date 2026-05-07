import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    target: ["es2020", "safari15"],
  },
  esbuild: {
    target: "es2020",
  },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
});
