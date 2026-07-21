const createBaseConfig = require("@sico/config/eslint.config.base.cjs");

module.exports = [
  ...createBaseConfig({ tsconfigRootDir: __dirname }),
  {
    // shadcn/ui components require prop spreading.
    rules: { "react/jsx-props-no-spreading": "off" },
  },
];
