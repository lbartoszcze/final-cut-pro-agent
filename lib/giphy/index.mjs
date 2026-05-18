// Giphy search + fetch client.
//
// Authentication via GIPHY_API_KEY env var; falls back to the documented
// public-beta key dc6zaTOxFJmzC (Giphy's anonymous-access default for
// early-stage apps). MP4 form is preferred over GIF so Final Cut Pro
// imports it as a standard video asset.
//
// CLI surface (via bin/cut.mjs `cut giphy <op>`):
//   cut giphy search <query> [<limit>]   list top results (title | mp4 url)
//   cut giphy get <query>                fetch the top result MP4 into .work/giphy-cache/

import { existsSync, mkdirSync, statSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { get as httpsGet } from "node:https";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CACHE = join(ROOT, ".work", "giphy-cache");
const PUBLIC_BETA_KEY = "dc6zaTOxFJmzC";

function apiKey() {
  return process.env.GIPHY_API_KEY || PUBLIC_BETA_KEY;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function getJson(url) {
  return new Promise((res, rej) => {
    httpsGet(url, { headers: { "user-agent": "final-cut-pro-agent/giphy-fetch" } }, (r) => {
      if (r.statusCode === 401 || r.statusCode === 403) {
        r.resume();
        const usingPublic = !process.env.GIPHY_API_KEY;
        const hint = usingPublic
          ? "Giphy's public-beta key no longer works for anonymous access. Set GIPHY_API_KEY=<your-key>: get a free key at https://developers.giphy.com/dashboard/."
          : "GIPHY_API_KEY rejected. Verify the key in the Giphy dashboard.";
        return rej(new Error(`HTTP ${r.statusCode}: ${hint}`));
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      }
      let body = "";
      r.setEncoding("utf8");
      r.on("data", (c) => body += c);
      r.on("end", () => {
        try { res(JSON.parse(body)); } catch (e) { rej(e); }
      });
    }).on("error", rej);
  });
}

function downloadToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((res, rej) => {
    httpsGet(url, { headers: { "user-agent": "final-cut-pro-agent/giphy-fetch" } }, (r) => {
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

export async function searchGifs(query, limit = 10) {
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey())}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`;
  const json = await getJson(url);
  if (!json.data) throw new Error(`giphy search: no data (meta: ${JSON.stringify(json.meta || {})})`);
  return json.data.map((g) => ({
    id: g.id,
    title: g.title,
    mp4: g.images?.original_mp4?.mp4 || g.images?.looping?.mp4 || null,
    gif: g.images?.original?.url || null,
    width: g.images?.original?.width,
    height: g.images?.original?.height,
  }));
}

export async function downloadGif(query) {
  const results = await searchGifs(query, 1);
  if (results.length === 0) throw new Error(`giphy: no results for ${query}`);
  const top = results[0];
  const url = top.mp4 || top.gif;
  if (!url) throw new Error(`giphy: top result has no playable URL (id ${top.id})`);
  const ext = url.includes(".mp4") ? ".mp4" : ".gif";
  const dest = join(CACHE, `${slugify(query)}-${top.id}${ext}`);
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  return downloadToFile(url, dest);
}

export async function main(args) {
  const op = args[0];
  if (!op || op === "help") {
    console.log("cut giphy — search + fetch Giphy assets as FCP-importable MP4");
    console.log("");
    console.log("  cut giphy search <query> [<limit>]   list top results (title | mp4 url)");
    console.log("  cut giphy get <query>                fetch the top result MP4 into .work/giphy-cache/");
    console.log("");
    console.log("Authentication: set GIPHY_API_KEY=<your-key>. Falls back to Giphy's");
    console.log("public-beta key for low-volume anonymous access.");
    return 0;
  }
  if (op === "search") {
    const query = args[1];
    if (!query) { console.error("search requires <query>"); return 2; }
    const limit = args[2] ? parseInt(args[2], 10) : 10;
    try {
      const results = await searchGifs(query, limit);
      for (const r of results) console.log(`${r.title || "(untitled)"}  |  ${r.mp4 || r.gif}`);
      return 0;
    } catch (e) {
      console.error(e.message);
      return 1;
    }
  }
  if (op === "get") {
    const query = args.slice(1).join(" ");
    if (!query) { console.error("get requires <query>"); return 2; }
    try {
      const path = await downloadGif(query);
      console.log(path);
      return 0;
    } catch (e) {
      console.error(e.message);
      return 1;
    }
  }
  console.error(`unknown giphy op: ${op}. Try 'cut giphy help'.`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0));
}
