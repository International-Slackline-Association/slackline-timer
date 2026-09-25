import eslintReact from '@eslint-react/eslint-plugin';
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules',
      '**/build',
      '**/dist',
      '**/lib',
      '**/public',
      '**/cdk.out',
      // Claude Code tooling (skills/driver scripts), not application source —
      // mixes node + browser-eval globals and is out of the app lint surface.
      '**/.claude',
    ],
  },
  eslint.configs.recommended,
  eslintPluginPrettierRecommended,
  ...tseslint.configs.recommended,
  // React linting is @eslint-react (`eslint-plugin-react` stalled at a peer
  // ceiling of eslint ^9.7 and blocked the eslint 10 move). Scoped to web/ —
  // the only package with React in it — so the CDK infra and the node scripts
  // don't pay for rules that cannot apply to them.
  {
    ...eslintReact.configs['recommended-typescript'],
    files: ['web/**/*.{ts,tsx}'],
    settings: {
      // Explicit version (not the config default "detect"): eslint runs from the
      // repo root where the react package isn't resolvable — react lives in
      // web/. Kept in step with web/.
      'react-x': { version: '19.2' },
    },
    rules: {
      ...eslintReact.configs['recommended-typescript'].rules,
      // Same call as `react-hooks/exhaustive-deps` below: this repo drives
      // effects deliberately and does not want the dependency-array rule.
      '@eslint-react/exhaustive-deps': 'off',
      // Off in every shipped config, but the repo has real `target="_blank"`
      // anchors and nothing else catches a missing rel=noreferrer.
      '@eslint-react/dom-no-unsafe-target-blank': 'error',

      // --- Rules switched off deliberately, not to silence a backlog. ---
      // The relay architecture IS state-derived-from-effects: control panels are
      // mirroring peers that apply inbound peer messages into local state
      // (ADR 0038), and the timers seed off a broadcast anchor. The hits are the
      // design, not a defect list.
      '@eslint-react/set-state-in-effect': 'off',
      // Naming style only (refs must end in `Ref`, setters must be `setFoo`) —
      // no correctness content, and not worth renaming through realtime code.
      '@eslint-react/naming-convention-ref-name': 'off',
      '@eslint-react/use-state': 'off',
      // React 19 style preferences: `use(Context)` over `useContext`, and
      // `<Context>` over `<Context.Provider>`. Both are real modernizations but
      // they rewrite the state-provider plumbing, which belongs in its own
      // change rather than riding along with a dependency upgrade.
      '@eslint-react/no-use-context': 'off',
      '@eslint-react/no-context-provider': 'off',
    },
  },
  {
    // The `app/auth` seam selects a whole strategy module per environment, so
    // the local-dev half must mirror the Cognito half's hook signature — its
    // callers invoke `useBaseAuth()`/`useCurrentUser()` as hooks. The `use`
    // prefix is the seam contract, even where the local stub calls no hook.
    files: ['web/src/app/auth/**/*.{ts,tsx}'],
    rules: { '@eslint-react/no-unnecessary-use-prefix': 'off' },
  },
  {
    // Positional art: flag stripes and bracket slots are fixed-length lists
    // rendered by position, and a flag row can legitimately repeat a country
    // code — so the index IS the stable identity and an `alpha2` key would
    // collide. The rule stays on everywhere else.
    files: [
      'web/src/app/pages/Stream/FlagBlock.tsx',
      'web/src/app/pages/Stream/flags/*.tsx',
      'web/src/app/pages/Admin/PlayoffBracket.tsx',
    ],
    rules: { '@eslint-react/no-array-index-key': 'off' },
  },
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: { 'react-hooks': reactHooks, 'unused-imports': unusedImports },
    rules: {
      'unused-imports/no-unused-imports': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // TELEMETRY token discipline (ADR 0034 §1/§6), enforced only where it is
    // clear-cut: React component source (`.tsx`). Raw hex and `var(--tl-*)`
    // strings are banned here — reach tokens through the MUI theme (`sx`
    // colors / `theme.palette`) or the imported `colors`/`fonts` objects.
    // The three canonical carriers of raw values (`app/theme/tokens.ts`,
    // `tokens.css`, `app/pages/Stream/overlayBg.ts`) are `.ts`/`.css`, so this
    // `.tsx`-only scope already exempts them without an allow-list.
    files: ['web/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}/]',
          message:
            'No raw hex colors in .tsx — use a TELEMETRY token (theme.palette / imported `colors`). See app/theme/tokens.ts.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}/]',
          message:
            'No raw hex colors in .tsx — use a TELEMETRY token (theme.palette / imported `colors`). See app/theme/tokens.ts.',
        },
        {
          selector: 'Literal[value=/var\\(--tl-/]',
          message:
            'No `var(--tl-*)` in .tsx — inside a React tree reach tokens via theme.palette / imported `colors`/`fonts`. `var(--tl-*)` is for non-React CSS/SVG seams only (ADR 0034 §1).',
        },
        {
          selector: 'TemplateElement[value.raw=/var\\(--tl-/]',
          message:
            'No `var(--tl-*)` in .tsx — inside a React tree reach tokens via theme.palette / imported `colors`/`fonts`. `var(--tl-*)` is for non-React CSS/SVG seams only (ADR 0034 §1).',
        },
      ],
    },
  },
  {
    // Node-side scripts, CDK infra, and config files (no browser globals).
    files: [
      '**/scripts/**/*.{js,mjs}',
      'web/internals/**/*.{js,mjs}',
      '**/infra/**/*.ts',
      '*.config.js',
      '*.config.mjs',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
