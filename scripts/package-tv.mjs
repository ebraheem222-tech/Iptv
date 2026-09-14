import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const output = path.join(root, "build");

function assertOwnedDirectory(target) {
  const resolved = path.resolve(target);
  if (resolved !== output && !resolved.startsWith(`${output}${path.sep}`)) {
    throw new Error(`Refusing to replace unexpected directory: ${resolved}`);
  }
}

async function packagePlatform(platform) {
  const target = path.join(output, platform);
  assertOwnedDirectory(target);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(dist, target, { recursive: true, force: true });

  if (platform === "samsung") {
    await cp(
      path.join(root, "tv/samsung/config.xml"),
      path.join(target, "config.xml"),
    );
    let html = await readFile(path.join(target, "index.html"), "utf8");
    html = html.replace(
      '  <script src="./app.js"></script>',
      '  <script src="$WEBAPIS/webapis/webapis.js"></script>\n  <script src="./app.js"></script>',
    );
    await writeFile(path.join(target, "index.html"), html);
  } else {
    await cp(
      path.join(root, "tv/lg/appinfo.json"),
      path.join(target, "appinfo.json"),
    );
    await cp(
      path.join(root, "public/icons/icon-80.png"),
      path.join(target, "icon.png"),
    );
    await cp(
      path.join(root, "public/icons/icon-130.png"),
      path.join(target, "largeIcon.png"),
    );
  }
}

await Promise.all(["samsung", "lg"].map(packagePlatform));
console.log("Prepared unsigned TV projects in build/samsung and build/lg.");
console.log(
  "Set window.NOVA_CONFIG.apiBase in each config.js before packaging for a fixed LAN backend.",
);
