const createBaseConfig = require("@sico/config/eslint.config.base.cjs");

module.exports = [
  ...createBaseConfig({ tsconfigRootDir: __dirname }),
  // One component per .tsx, shared-only: @sico/ui ships shadcn compound
  // components that legitimately export several parts from one file.
  {
    files: ["**/*.tsx"],
    rules: {
      "react/no-multi-comp": ["error", { ignoreStateless: false }],
    },
  },
  // Same test/stories/e2e carve-out the base config grants the size caps.
  {
    files: ["test/**/*.tsx", "**/stories/**/*.tsx", "**/e2e/**/*.tsx"],
    rules: {
      "react/no-multi-comp": "off",
    },
  },
];
