// Brainrot / meme SFX library: list / fetch / get-local-path helpers + CLI.
//
// Catalog at lib/sfx/catalog.json defines canonical names (vine-boom,
// faaa-peter, bruh, discord-ping, etc.) with optional source URLs (best-
// effort public mirrors — myinstants.com direct MP3 paths). User can
// override per-name via FCP_SFX_DIR=<dir> env var (any
// <dir>/<name>.<ext> file takes precedence over the cataloged URL).
//
// CLI surface (via bin/cut.mjs `cut sfx <op>`):
//   cut sfx list                  list catalog rows
//   cut sfx get <name>            fetch the named SFX into .work/sfx-cache/
//   cut sfx where <name>          print the cached path (fetch if missing)

import { readFileSync, existsSync, mkdirSync, statSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CATALOG = JSON.parse(readFileSync(join(HERE, "catalog.json"), "utf8")).sfx;
const CACHE = join(ROOT, ".work", "sfx-cache");

export function listSfx() {
  return Object.entries(CATALOG).map(([name, row]) => ({
    name,
    category: row.category,
    durationHintSec: row.duration_hint_sec,
    description: row.description,
    url: row.url,
  }));
}

function userOverridePath(name) {
  const dir = process.env.FCP_SFX_DIR;
  if (!dir) return null;
  for (const ext of [".mp3", ".wav", ".m4a", ".aac"]) {
    const p = join(dir, name + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

function cachePath(name, url) {
  const ext = extname(new URL(url).pathname) || ".mp3";
  return join(CACHE, name + ext);
}

// Promise-wrapped GET that follows 3xx redirects and writes the body to a
// file. Resolves with the local path on 200, rejects with HTTP code on any
// non-2xx terminal status.
function downloadToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((res, rej) => {
    const protoGet = url.startsWith("https:") ? httpsGet : httpGet;
    protoGet(url, { headers: { "user-agent": "final-cut-pro-agent/sfx-fetch" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirectsLeft > 0) {
        const next = new URL(r.headers.location, url).toString();
        r.resume();
        return downloadToFile(next, destPath, redirectsLeft - 1).then(res, rej);
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      }
      mkdirSync(dirname(destPath), { recursive: true });
      const file = createWriteStream(destPath);
      r.pipe(file);
      file.on("finish", () => file.close(() => res(destPath)));
      file.on("error", rej);
    }).on("error", rej);
  });
}

export async function fetchSfx(name) {
  const override = userOverridePath(name);
  if (override) return override;
  const row = CATALOG[name];
  if (!row) throw new Error(`unknown sfx: ${name}. Available: ${Object.keys(CATALOG).join(", ")}`);
  if (!row.url) throw new Error(`sfx "${name}" has no cataloged URL; set FCP_SFX_DIR=<dir> with ${name}.mp3`);
  const dest = cachePath(name, row.url);
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  return downloadToFile(row.url, dest);
}

export async function getSfxPath(name) {
  return fetchSfx(name);
}

// CLI entrypoint — invoked from bin/cut.mjs `cut sfx <op>`.
export async function main(args) {
  const op = args[0];
  if (!op || op === "help") {
    console.log("cut sfx — brainrot / meme SFX library");
    console.log("");
    console.log("  cut sfx list              list cataloged SFX (name | category | desc)");
    console.log("  cut sfx get <name>        fetch into .work/sfx-cache/ (idempotent)");
    console.log("  cut sfx where <name>      print local path (fetch if missing)");
    console.log("");
    console.log("Override the URL pool: set FCP_SFX_DIR=<dir>. Any file matching");
    console.log("<dir>/<name>.{mp3,wav,m4a,aac} takes precedence over the cataloged URL.");
    return 0;
  }
  if (op === "list") {
    const rows = listSfx();
    const w = Math.max(...rows.map((r) => r.name.length));
    for (const r of rows) console.log(`${r.name.padEnd(w)}  ${r.category.padEnd(10)}  ${r.durationHintSec}s  ${r.description}`);
    return 0;
  }
  if (op === "get" || op === "where") {
    const name = args[1];
    if (!name) { console.error(`${op} requires <name>`); return 2; }
    try {
      const p = await fetchSfx(name);
      console.log(p);
      return 0;
    } catch (e) {
      console.error(e.message);
      return 1;
    }
  }
  console.error(`unknown sfx op: ${op}. Try 'cut sfx help'.`);
  return 2;
}

// Allow direct invocation: `node lib/sfx/index.mjs list`.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0));
}
