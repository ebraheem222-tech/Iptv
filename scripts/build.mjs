import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

function assertOwnedDirectory(target, expectedName) {
  const resolved = path.resolve(target);
  if (
    resolved !== path.join(root, expectedName) ||
    !resolved.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error(`Refusing to replace unexpected directory: ${resolved}`);
  }
}

assertOwnedDirectory(dist, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/main.jsx")],
  outfile: path.join(dist, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome68"],
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  sourcemap: false,
  legalComments: "external",
  loader: {
    ".js": "jsx",
    ".jsx": "jsx",
    ".png": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".svg": "file",
  },
  assetNames: "assets/[name]-[hash]",
  logLevel: "info",
});

await cp(path.join(root, "public"), dist, { recursive: true, force: true });

await writeFile(
  path.join(dist, "config.js"),
  "window.NOVA_CONFIG = Object.assign({ apiBase: '' }, window.NOVA_CONFIG || {});\n",
);

await writeFile(
  path.join(dist, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="theme-color" content="#080b0a">
  <title>Nova TV</title>
  <link rel="stylesheet" href="./app.css">
</head>
<body>
  <div id="root"></div>
  <script src="./config.js"></script>
  <script src="./app.js"></script>
</body>
</html>
`,
);

console.log("Built dist/ as a classic Chrome 68-compatible bundle.");
