// Vite/Rollup static asset imports — `import url from "./foo.svg"`
// resolves to the file's URL string at build time.
declare module "*.svg" {
  const url: string;
  export default url;
}

// `?url` suffix forces an external URL (never inlined as data URL),
// regardless of `build.assetsInlineLimit`. Use this for assets that
// must remain a fetchable resource (e.g. `<img src>` cache, CSP).
declare module "*.svg?url" {
  const url: string;
  export default url;
}
