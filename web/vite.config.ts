import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import checker from 'vite-plugin-checker';
import tsconfigPaths from 'vite-tsconfig-paths';

// src/app/constants.ts reads exactly these and has no fallbacks (ADR 0048), so
// a build missing one only fails once a browser has been served the bundle.
// Refuse to emit it instead.
const REQUIRED_ENV = [
  'VITE_APP_WS_URL',
  'VITE_APP_API_URL',
  'VITE_APP_COGNITO_USER_POOL_ID',
  'VITE_APP_COGNITO_CLIENT_ID',
  'VITE_APP_COGNITO_DOMAIN',
  'VITE_APP_COGNITO_TIMER_GROUP',
];

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // loadEnv merges the prefixed vars from process.env, which is how the deploy
  // tooling's resolved values reach both this guard and the bundle.
  const env = loadEnv(mode, process.cwd(), 'VITE_APP');
  if (command === 'build') {
    // LOCAL_DEV disables the UI auth gate and sends a dummy Authorization token.
    // `vite build` doesn't read .env.development, but a stray shell export or
    // .env(.production) would leak it in.
    if (env.VITE_APP_LOCAL_DEV === 'true') {
      throw new Error(
        'Refusing to build with VITE_APP_LOCAL_DEV=true — it disables the auth gate.',
      );
    }

    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Refusing to build without ${missing.join(', ')} — the bundle has no fallbacks. ` +
          `Build through the deploy tooling (CDK stack outputs + .env.deploy), or export ` +
          `them / set them in web/.env.production.local.`,
      );
    }
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
