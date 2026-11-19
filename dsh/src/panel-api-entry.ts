/**
 * The esbuild entry point of the `dsh/panel/api.js` artifact.
 *
 * This file is a build input only. No runtime path loads it, and `dsh/lib/`
 * never imports it. `dsh/build.mjs` bundles it with the `api` target and
 * writes the result to `dsh/panel/api.js`.
 *
 * The two imports name the web package source files, never `web/dist/`.
 * The reason is the bundle content. `web/src/server/index.ts` imports
 * `hono` at its top, and a build over `web/dist/` therefore carries a
 * `hono` import into the artifact. `web/src/server/static.ts` imports
 * `node:fs` and `node:path` only, so a source-level import gives the SPA
 * handler with no third-party server package. The backend adds `zod`,
 * which esbuild inlines. The root package keeps zero runtime dependencies.
 *
 * See implementation.md section 3.8 and Decision 4 of the
 * `harness-support/dsh-web-panel` feature.
 */

export { createBeastBackend } from "../../web/src/backend/index.js";
export { createStaticHandler } from "../../web/src/server/static.js";
