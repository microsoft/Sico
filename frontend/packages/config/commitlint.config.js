export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2, "always",
      ["config", "ui", "shared", "app", "deps", "ci", "infra"]
    ],
    "scope-empty": [1, "never"],
  },
};
