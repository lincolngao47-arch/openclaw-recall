import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tarballPath = findLatestTarball(path.join(repoRoot, ".release"));
const listing = execFileSync("tar", ["-tf", tarballPath], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const requiredEntries = [
  "package/package.json",
  "package/openclaw.plugin.json",
  "package/dist/src/plugin/index.js",
  "package/dist/src/cli/index.js",
  "package/README.md",
  "package/QUICKSTART.md",
  "package/OPENCLAW-INTEGRATION.md",
  "package/TROUBLESHOOTING.md",
  "package/CHANGELOG.md",
  "package/NOTICE",
  "package/LICENSE",
];

for (const entry of requiredEntries) {
  assert(listing.includes(entry), `expected tarball to contain ${entry}`);
}

const forbiddenMatchers = [
  /^package\/node_modules\//,
  /^package\/tests\//,
  /^package\/scripts\//,
  /^package\/dist\/scripts\//,
  /^package\/dist\/src\/testing\//,
];
for (const entry of listing) {
  assert(
    !forbiddenMatchers.some((matcher) => matcher.test(entry)),
    `unexpected tarball entry: ${entry}`,
  );
}

const packageJson = JSON.parse(
  execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  }),
) as { name?: string; version?: string; files?: string[] };

assert.equal(packageJson.name, "@felix201209/openclaw-recall");
assert.ok(typeof packageJson.version === "string" && packageJson.version.length > 0);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      tarball: tarballPath,
      sizeBytes: fs.statSync(tarballPath).size,
      fileCount: listing.length,
      requiredEntries,
      packageName: packageJson.name,
      version: packageJson.version,
    },
    null,
    2,
  )}\n`,
);

function findLatestTarball(releaseDir: string): string {
  const entries = fs
    .readdirSync(releaseDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => ({
      entry,
      mtimeMs: fs.statSync(path.join(releaseDir, entry)).mtimeMs,
    }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  assert(entries.length > 0, `no tarball found in ${releaseDir}`);
  return path.join(releaseDir, entries.at(-1)!.entry);
}
