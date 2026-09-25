import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import checker from 'vite-plugin-checker';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // LOCAL_DEV disables the UI auth gate and sends a dummy Authorization token —
  // it must never reach a production bundle. `vite build` doesn't read
  // .env.development, but a stray shell export or .env(.production) would leak
  // it in, so fail the build outright.
  const env = loadEnv(mode, process.cwd(), 'VITE_APP');
  if (command === 'build' && env.VITE_APP_LOCAL_DEV === 'true') {
    throw new Error('Refusing to build with VITE_APP_LOCAL_DEV=true — it disables the auth gate.');
  }

  return {
    assetsInclude: ['**/*.mp3'],
    server: {
      fs: {
        // `app/manual` bundles the published user manual straight out of
        // `doc/user/*.md` (repo root, one level above this package — there are
        // no npm workspaces, so Vite's default allow-list stops at `web/`).
        // Build-time inlining needs no exemption; the dev server does.
        allow: ['..'],
      },
    },
    plugins: [
      react(),
      tsconfigPaths(),
      checker({
        overlay: true,
        typescript: true,
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          // Split the heavy vendor deps into their own chunks so the app entry
          // stays small and these rarely-changing bundles cache well. Match by
          // path so the transitive tree of each lib lands in its own chunk.
          //   - amplify: aws-amplify plus its `@aws-amplify/*` + AWS SDK
          //              (`@aws-sdk/*`, `@smithy/*`) transitive tree.
          //   - mui:     the MUI/emotion cluster, the next-largest group.
          // (Flags used to be the biggest dep — react-world-flags inlined every
          //  country SVG into one ~3.7 MB module. They're now the vendored
          //  flag-icons artwork in `src/app/flag-icons`: CSS + per-country SVG
          //  assets fetched on demand, no JS vendor chunk.)
          manualChunks(id) {
            if (/node_modules\/(aws-amplify|@aws-amplify|@aws-sdk|@smithy)\//.test(id)) {
              return 'amplify';
            }
            if (/node_modules\/(@mui|@emotion)\//.test(id)) {
              return 'mui';
            }
          },
        },
      },
    },
  };
});
