// @ts-check
/**
 * Lint configuration for both packages.
 *
 * Until now nothing enforced any standard — no linter, no formatter, no CI —
 * so every quality property in this repo rested on whoever last touched it
 * being careful. This is the part that makes it stick.
 *
 * Formatting is Prettier's job alone; `eslint-config-prettier` switches off
 * every stylistic rule so the two cannot disagree. What is left are rules
 * about correctness and intent.
 */

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'mobile/assets/**',
      // CloudFormation templates synthesised from infra/lib. Generated, large,
      // and not source.
      'infra/cdk.out/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      // projectService resolves each file against whichever tsconfig owns it,
      // which is what lets one config lint two packages with different targets.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.es2022 },
    },

    rules: {
      /* --- Correctness, the rules that catch real defects --------------- */

      // A floating promise is how a failed write becomes silent. Several of
      // the bugs in this repo's history were exactly that shape.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      /*
       * `require-await` is off, and `no-await-in-loop` with it.
       *
       * Both are wrong for this codebase rather than inconvenient. An `async`
       * function with no `await` is usually correct here: it satisfies an
       * interface that promises a Promise — `getAccessToken`, the sync
       * callbacks — and rewriting those to return `Promise.resolve(x)` would
       * obscure that. And the awaits inside loops are deliberately sequential:
       * WatermelonDB writes and the chunked upserts depend on ordering, so
       * parallelising them would be a bug, not an optimisation.
       */
      '@typescript-eslint/require-await': 'off',
      'no-await-in-loop': 'off',

      /* --- Type safety --------------------------------------------------- */

      // `any` disables the compiler exactly where the code is hardest to
      // reason about. Warn for now; the remaining uses are tracked and being
      // removed rather than grandfathered silently.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      /*
       * These two are off because their autofixes actively broke working code
       * when first enabled, which is worse than the inconsistency they police.
       *
       * `consistent-type-definitions` rewrote React Navigation's param list
       * from a type alias to an interface, and an interface does not satisfy
       * `ParamListBase`'s index-signature constraint — the app stopped
       * compiling.
       *
       * `no-unnecessary-type-assertion` stripped assertions on values that
       * come back as `any` (Fastify's `res.json()`), which the compiler
       * considers redundant but which are the only thing giving those values a
       * type. Removing them silently degraded the tests to implicit `any`.
       */
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      /* --- Hygiene ------------------------------------------------------- */

      '@typescript-eslint/no-unused-vars': [
        'error',
        // A leading underscore is the documented way to say "required by the
        // signature, deliberately unused".
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* --- React --------------------------------------------------------- */
  {
    files: ['mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, __DEV__: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A stale dependency array is a whole class of "why is this showing old
      // data" bug, and this app is full of derived state.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  /* --- Tests ---------------------------------------------------------- */
  {
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/jest.setup.js',
    ],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      // Tests deliberately construct partial objects and reach past types to
      // set up states the app should never produce.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // jest.mock factories are hoisted above imports, so they can only reach
      // a module through require().
      '@typescript-eslint/no-require-imports': 'off',
      // A test may deliberately start work and not await it — that is often
      // the behaviour under test.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  /* --- Config and script files ---------------------------------------- */
  {
    // These sit outside either package's tsconfig `include`, so there is no
    // type information for them and the typed rules must be switched off —
    // spreading disableTypeChecked's own rules first, or the local `rules`
    // block below would replace them wholesale and the typed rules would
    // still try to run.
    files: ['**/*.{js,mjs,cjs}', '**/*.config.{ts,mts}'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  prettier,
);
