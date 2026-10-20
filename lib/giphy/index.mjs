// Giphy search + fetch client.
//
// Two paths:
//   1. API path — when GIPHY_API_KEY is set, Giphy's v1 search endpoint, with
//      the content rating GIPHY_RATING names (refused by name when missing).
//      Its results carry titles.
//   2. Scrape path — no key. Fetches giphy.com/search/<query> HTML, reads
//      each /gifs/<slug>-<id> link's id (the last dash-separated part of the
//      path segment) and builds media.giphy.com/media/<id>/giphy.mp4 from it.
//
// MP4 form is preferred over GIF so Final Cut Pro imports as a standard
// video asset. A search returns what the source returns by itself: the API's
// own page of results, or every GIF the search page links, in its order.
//
// CLI surface (via bin/cut.mjs `cut giphy <op>`):
//   cut giphy search <query>   list results (title | mp4 url)
//   cut giphy get <query>      fetch the first result's MP4 into .work/giphy-cache/

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as http } from "node:http2";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { EXIT_FAILURE, EXIT_SUCCESS, EXIT_USAGE } from "../cli/exit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CACHE = join(ROOT, ".work", "giphy-cache");
const USER_AGENT = "final-cut-pro-agent";

async function fetchOk(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (response.status === http.HTTP_STATUS_UNAUTHORIZED || response.status === http.HTTP_STATUS_FORBIDDEN) {
    throw new Error(`HTTP ${response.status} from Giphy: GIPHY_API_KEY was refused; verify the key in the Giphy dashboard.`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  return response;
}

// Every /gifs/<slug>-<id> link of the search page, in page order (Giphy's
// relevance order), each id once.
async function scrapeSearchHtml(query) {
  const url = `https://giphy.com/search/${encodeURIComponent(query.replace(/\s+/g, "-"))}`;
  const html = await (await fetchOk(url)).text();
  const ids = [...new Set([...html.matchAll(/\/gifs\/([\w-]+)/g)].map(([, segment]) => segment.split("-").pop()))];
  if (!ids.length) throw new Error(`giphy scrape: no GIF links found in the search page for "${query}"`);
  return ids;
}

export async function searchGifs(query) {
  const key = process.env.GIPHY_API_KEY?.trim();
  if (key) {
    const rating = process.env.GIPHY_RATING?.trim();
    if (!rating) throw new Error("GIPHY_RATING is not set: the content rating Giphy API searches are limited to (g, pg, pg-13 or r)");
    const params = new URLSearchParams({ api_key: key, q: query, rating });
    const json = await (await fetchOk(`https://api.giphy.com/v1/gifs/search?${params}`)).json();
    if (!Array.isArray(json.data)) throw new Error(`giphy search answered no data: ${JSON.stringify(json)}`);
    return json.data.map((g) => ({
      id: g.id,
      title: g.title,
      mp4: g.images.original.mp4,
      gif: g.images.original.url,
      width: g.images.original.width,
      height: g.images.original.height,
      via: "api",
    }));
  }
  const ids = await scrapeSearchHtml(query);
  return ids.map((id) => ({
    id,
    mp4: `https://media.giphy.com/media/${id}/giphy.mp4`,
    gif: `https://media.giphy.com/media/${id}/giphy.gif`,
    via: "scrape",
  }));
}

export async function downloadGif(query) {
  const [top] = await searchGifs(query);
  if (!top) throw new Error(`giphy: no results for ${query}`);
  if (!top.mp4) throw new Error(`giphy: the first result for ${query} has no MP4 rendition (id ${top.id})`);
  const dest = join(CACHE, `${top.id}.mp4`);
  if (existsSync(dest) && statSync(dest).size) return dest;
  const response = await fetchOk(top.mp4);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  return dest;
}

// The operations of `cut giphy`, by the name the command line gives them.
const OPERATIONS = {
  async search(query) {
    for (const r of await searchGifs(query)) console.log([r.title, r.mp4].filter(Boolean).join("  |  "));
  },
  async get(query) {
    console.log(await downloadGif(query));
  },
};

function help() {
  console.log("cut giphy — search + fetch Giphy assets as FCP-importable MP4");
  console.log("");
  console.log("  cut giphy search <query>   list results (title | mp4 url)");
  console.log("  cut giphy get <query>      fetch the first result's MP4 into .work/giphy-cache/");
  console.log("");
  console.log("Authentication: optional. With GIPHY_API_KEY set, searches use");
  console.log("Giphy's API and need GIPHY_RATING (g, pg, pg-13 or r). Without");
  console.log("it, the client reads giphy.com/search and builds CDN MP4 URLs.");
}

/** `cut giphy <op> <query>`; answers the process exit status. */
export async function main(args) {
  const [op, ...rest] = args;
  if (!op || op === "help") {
    help();
    return EXIT_SUCCESS;
  }
  if (!Object.hasOwn(OPERATIONS, op)) {
    console.error(`unknown giphy op: ${op}. Try 'cut giphy help'.`);
    return EXIT_USAGE;
  }
  const query = rest.join(" ");
  if (!query) {
    console.error(`${op} requires <query>`);
    return EXIT_USAGE;
  }
  try {
    await OPERATIONS[op](query);
    return EXIT_SUCCESS;
  } catch (e) {
    console.error(e.message);
    return EXIT_FAILURE;
  }
}
