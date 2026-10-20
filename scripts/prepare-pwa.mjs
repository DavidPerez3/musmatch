// Give every exported release its own worker/cache without embedding environment values.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
}
const assets = (await files("out/_next/static"))
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => f.slice(4).replaceAll(path.sep, "/"))
  .sort();
const version = createHash("sha256")
  .update(await readFile(".next/BUILD_ID"))
  .update(await readFile("public/sw.js"))
  .update(await readFile("public/offline.html"))
  .digest("hex")
  .slice(0, 16);
const source = (await readFile("public/sw.js", "utf8"))
  .replace("__MUSMATCH_BUILD__", version)
  .replace(
    /const PRECACHE = \[\];\s*\/\* MUSMATCH_PRECACHE \*\//,
    `const PRECACHE = ${JSON.stringify(assets)};`,
  );
if (
  source.includes("__MUSMATCH_BUILD__") ||
  source.includes("/* MUSMATCH_PRECACHE */")
)
  throw new Error("Worker template not compiled");
await writeFile("out/sw.js", source);
console.log(`PWA release ${version}: ${assets.length} public assets`);
