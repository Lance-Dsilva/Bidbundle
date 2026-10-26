import { FlatCompat } from "@eslint/eslintrc";

// Run explicitly through `npm run lint`. The non-default filename keeps newly
// introduced lint checks from changing the existing Next.js deployment build
// gate before the repository's pre-existing lint findings have been resolved.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "next-env.d.ts",
      "coverage/**",
      "dist/**",
      "out/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
