import { createRequire } from "node:module";
import path from "node:path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:8080";
// The dwp backend is a DIFFERENT origin from sico's (self-signed TLS, hence
// `secure: false` on its proxy entry). Both routes stay registered so a single
// `vite dev` serves either backend depending on the active build profile.
const DWP_API_TARGET =
  process.env.VITE_DWP_API_TARGET ?? "https://test.sico.microsoft.com";

// pdfjs-dist ships its cMap (CJK character maps) + standard-font assets inside
// the npm package but not in the JS bundle. Resolve the package root via
// `require.resolve` (robust to pnpm's symlinked layout) and copy both dirs into
// `dist/pdfjs/` at build time, so the shared PDF viewer can fetch them from
// `<BASE_URL>/pdfjs/{cmaps,standard_fonts}/` at runtime — no binaries vendored
// into git, and the asset version tracks the installed pdfjs-dist automatically.
const require = createRequire(import.meta.url);
const PDFJS_DIST_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));

export default defineConfig({
  plugins: [
    // Must run before react(): codegen output needs to be in the SWC set.
    // The generator only applies quoteStyle/semicolons when it formats the
    // output via prettier (enableRouteTreeFormatting). Without prettier it
    // silently falls back to raw single-quote output, so routeTree.gen.ts
    // churned against main (which was committed double-quoted). Pin the style
    // AND keep formatting on; prettier is a devDependency so the pass runs.
    // The file itself is ignored by oxfmt/eslint.
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      quoteStyle: "double",
      semicolons: true,
      enableRouteTreeFormatting: true,
    }),
    tailwindcss(),
    react(),
    viteStaticCopy({
      // `stripBase` flattens the deep absolute `src` path so the files land at
      // `dist/pdfjs/<dir>/` (not nested under the resolved node_modules path).
      targets: ["cmaps", "standard_fonts"].map((dir) => ({
        src: path.join(PDFJS_DIST_DIR, dir).replace(/\\/g, "/"),
        dest: `pdfjs/${dir}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api/sico": {
        target: API_TARGET,
        changeOrigin: true,
        // Safe for localhost http target; flip back for remote dev hosts.
        secure: false,
        // Proxy WebSocket upgrades (`/api/sico/ws/*`).
        ws: true,
      },
      // sico-nginx rewrites filer URLs to same-origin /storage/* via sub_filter.
      "/storage": {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
      "/api/dwp": {
        target: DWP_API_TARGET,
        changeOrigin: true,
        // dwp backend serves self-signed TLS — don't reject it in dev.
        secure: false,
        ws: true,
      },
    },
  },
});
