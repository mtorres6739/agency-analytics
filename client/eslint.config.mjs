// import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
// import nextTypescript from "eslint-config-next/typescript";

// const eslintConfig = [
//   ...nextCoreWebVitals,
//   ...nextTypescript,
//   {
//     rules: {
//       "@typescript-eslint/no-explicit-any": "off",
//     },
//     ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
//   },
// ];

// export default eslintConfig;

// Keep generated output out of the fallback lint pass while the upstream
// Next.js rules remain disabled. Without this, running lint after a production
// build scans Turbopack bundles and reports rules that are not project source.
export default [{ ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"] }];
