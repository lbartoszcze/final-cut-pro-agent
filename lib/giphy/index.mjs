// Giphy search + fetch client.
//
// Two paths:
//   1. API path — when GIPHY_API_KEY env var is set, uses Giphy's v1 REST
//      endpoints. Most accurate metadata, includes titles + ratings.
//   2. Scrape path — no key required. Fetches giphy.com/search/<query>
//      HTML, extracts unique GIF IDs from /gifs/<slug>-<id> link patterns,
//      constructs media.giphy.com/media/<id>/giphy.mp4 URLs directly.
//      Confirmed 2026-05-17: returns 200 video/mp4 without auth.
//
// MP4 form is preferred over GIF so Final Cut Pro imports as a standard
// video asset.
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
function apiKey() {
  return process.env.GIPHY_API_KEY || null;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function getText(url, ua) {
  return new Promise((res, rej) => {
    httpsGet(url, { headers: { "user-agent": ua || "Mozilla/5.0 (final-cut-pro-agent)" } }, (r) => {
      if (r.statusCode === 401 || r.statusCode === 403) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode}: GIPHY_API_KEY rejected. Verify the key in the Giphy dashboard.`));
      }
      if (r.statusCode !== 200) {
        r.resume();
        return rej(new Error(`HTTP ${r.statusCode} for ${url}`));
      }
      let body = "";
      r.setEncoding("utf8");
      r.on("data", (c) => body += c);
      r.on("end", () => res(body));
    }).on("error", rej);
  });
}

async function getJson(url) {
  const body = await getText(url, "final-cut-pro-agent/giphy-fetch");
  return JSON.parse(body);
}

// Scrape giphy.com/search/<query> for GIF IDs. Each ID rebuilds into the
// public CDN MP4 URL pattern media.giphy.com/media/<id>/giphy.mp4.
// Returns `limit` unique IDs in source order (relevance-sorted by Giphy).
async function scrapeSearchHtml(query, limit) {
  const url = `https://giphy.com/search/${encodeURIComponent(query.replace(/\s+/g, "-"))}`;
  const html = await getText(url);
  const seen = new Set();
  const ids = [];
  const re = /\/gifs\/[A-Za-z0-9-]*?([A-Za-z0-9]{8,})(?=["'?\s])/g;
  let m;
  while ((m = re.exec(html)) !== null && ids.length < limit) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) throw new Error(`giphy scrape: no GIF IDs found in search HTML for "${query}"`);
  return ids;
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
  const key = apiKey();
  if (key) {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`;
    const json = await getJson(url);
    if (!json.data) throw new Error(`giphy search: no data (meta: ${JSON.stringify(json.meta || {})})`);
    return json.data.map((g) => ({
      id: g.id,
      title: g.title,
      mp4: g.images?.original_mp4?.mp4 || g.images?.looping?.mp4 || null,
      gif: g.images?.original?.url || null,
      width: g.images?.original?.width,
      height: g.images?.original?.height,
      via: "api",
    }));
  }
  // No API key — scrape the public search page and rebuild CDN MP4 URLs.
  const ids = await scrapeSearchHtml(query, limit);
  return ids.map((id) => ({
    id,
    title: id,
    mp4: `https://media.giphy.com/media/${id}/giphy.mp4`,
    gif: `https://media.giphy.com/media/${id}/giphy.gif`,
    via: "scrape",
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
    console.log("Authentication: optional. With no GIPHY_API_KEY set, the");
    console.log("client scrapes giphy.com/search and rebuilds CDN MP4 URLs");
    console.log("(no key, lower metadata fidelity). For the API path + titles,");
    console.log("run scripts/obtain-giphy-key.mjs to provision a key into .env");
    console.log("(CapSolver-backed signup), or set GIPHY_API_KEY=<your-key>.");
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
