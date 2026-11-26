import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

// The service-role key bypasses RLS, so only the invitation route may reach it. The `*` stands for the `[id]` directory:
// square brackets are glob syntax, so `[id]` itself would match the single letters i and d.
const adminClientConfig = defineConfig({
  files: ["src/**/*.{ts,tsx,astro}"],
  ignores: ["src/lib/supabase-admin.ts", "src/pages/api/employees/*/invite.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/lib/supabase-admin", "**/supabase-admin"],
            message: "Klucz service-role wolno użyć tylko w trasie zaproszenia",
          },
        ],
      },
    ],
  },
});

// The rules in `src/lib/services/` read dates in UTC. The tests run in workerd, whose time zone is UTC, and the spy of
// `localDateMethodsCalledBy` (src/lib/testing/local-time.ts) only sees the local getters and setters of `Date`, so the
// forms below would pass every test and give another day on a machine in another zone: a date built from components
// (`new Date(y, m, d)`) and a date-time string without `Z` or an offset, which is read as local time. A string that
// reaches `new Date` through a variable cannot be seen by a selector; the tests have to cover that case.
const NEW_DATE = "NewExpression[callee.name='Date']";
// A time of day at the very end of a string, after a `T` or a space: no `Z` and no offset follows it. An offset such as
// `+02:00` is not matched, because no `T` or space stands before its digits.
const TIME_OF_DAY_AT_END = String.raw`[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$`;
const DATE_TIME_WITHOUT_OFFSET_MESSAGE =
  "A date-time string without `Z` or an offset is read in the local time zone: end it with `Z` or an offset, or build the date with `Date.UTC`";
const localTimeSyntax = [
  {
    selector: `${NEW_DATE}:matches([arguments.length>=2], [arguments.0.type='SpreadElement'])`,
    message: "`new Date(y, m, d)` reads its components in the local time zone: use `new Date(Date.UTC(y, m, d))`",
  },
  // The same string as a literal, as a template literal (its last part) and as the right side of a `+`.
  { selector: `${NEW_DATE} > Literal[value=/${TIME_OF_DAY_AT_END}/]`, message: DATE_TIME_WITHOUT_OFFSET_MESSAGE },
  {
    selector: `${NEW_DATE} > TemplateLiteral > TemplateElement[tail=true][value.cooked=/${TIME_OF_DAY_AT_END}/]`,
    message: DATE_TIME_WITHOUT_OFFSET_MESSAGE,
  },
  {
    selector: `${NEW_DATE} > BinaryExpression[operator='+'][right.value=/${TIME_OF_DAY_AT_END}/]`,
    message: DATE_TIME_WITHOUT_OFFSET_MESSAGE,
  },
];
const dateParseSyntax = {
  selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
  message:
    "`Date.parse` reads a string without `Z` or an offset in the local time zone: build the date with `Date.UTC` or `new Date` of a string that ends with `Z` or an offset",
};
// The files that order or age rows by the `timestamptz` strings PostgREST returns, which always carry an offset, so
// `Date.parse` is safe there. The rest of the syntax above stays forbidden in them.
const DATE_PARSE_FILES = [
  "src/lib/services/employee.ts",
  "src/lib/services/invitation.ts",
  "src/lib/services/schedule.ts",
  "src/lib/services/shift.ts",
];
// Test files are left out: they build the fixtures, and `new Date(0)` or `Date.parse` of a `Z` string is legitimate there.
const localTimeConfig = defineConfig(
  {
    files: ["src/lib/services/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...localTimeSyntax, dateParseSyntax] },
  },
  // A later object with the same rule replaces the options of the earlier one for these files, so the list is repeated
  // without the `Date.parse` entry instead of being switched off.
  { files: DATE_PARSE_FILES, rules: { "no-restricted-syntax": ["error", ...localTimeSyntax] } },
);

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: { globals: { console: true, process: true, fetch: true, URL: true, URLSearchParams: true } },
  rules: { "no-console": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  adminClientConfig,
  localTimeConfig,
  scriptsConfig,
  eslintPluginPrettier,
);
