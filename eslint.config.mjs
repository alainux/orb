import tseslint from "typescript-eslint";

/**
 * Orb's lint standard. Kept deliberately tight around the things that matter:
 * no explicit `any` escaping the type system (in production or tests), and no
 * unused vars. The seam helpers in `tests/support/seams.ts` are the *single*
 * sanctioned bridge to otherwise-private test internals — prefer them over a
 * bare `as any`.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".test-dist/**",
      "coverage/**",
      "**/*.d.ts",
      "test-shims/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "extensions/**/*.ts", "scripts/**/*.ts"],
    rules: {
      // The whole point of this config: no `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Deliberate: we prioritize type-safety over blanket ban-on-`any`cast
      // messaging; require_explicit exceptions stay reviewable.
    },
  },
);