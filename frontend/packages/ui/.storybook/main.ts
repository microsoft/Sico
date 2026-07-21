import type { StorybookConfig } from "@storybook/react-vite";
import remarkGfm from "remark-gfm";

const config: StorybookConfig = {
  addons: [
    "@storybook/addon-themes",
    {
      name: "@storybook/addon-docs",
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [remarkGfm],
          },
        },
      },
    },
    "storybook-addon-rtl",
    "@storybook/addon-a11y",
    "storybook-design-token",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // storybook-design-token writes its parsed token JSON to public/ and the
  // manager fetches it from the static root — serve public/ so it resolves.
  staticDirs: ["../public"],
  stories: ["../stories/**/*.mdx", "../stories/**/*.stories.@(ts|tsx)"],
  // The addon emits public/design-tokens.source.json from a Vite transform
  // hook; without ignoring it the publicDir watcher re-triggers HMR in a loop.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    server: {
      ...viteConfig.server,
      watch: {
        ...viteConfig.server?.watch,
        ignored: ["**/public/design-tokens.source.json"],
      },
    },
  }),
};
export default config;
