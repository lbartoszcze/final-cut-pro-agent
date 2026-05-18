#!/usr/bin/env node
// Obtain a Giphy developer API key autonomously: signup at giphy.com/join
// (CapSolver-solved reCAPTCHA) -> Resend-polled email verify -> dashboard
// -> create app -> persist GIPHY_API_KEY to <repo>/.env. Each failure path
// prints a labeled BLOCKER and exits non-zero.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { pollInbox, fetchEmailBody, extractGiphyVerifyLink } from "../lib/giphy/resend-inbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENV_PATH = join(ROOT, ".env");
const WELES_PLAYWRIGHT = "/Users/lukaszbartoszcze/Documents/CodingProjects/Wisent/weles/node_modules/playwright/index.mjs";
const RESEND_KEY = "re_P6PYQQiY_4qKAuTtBzyWKWWKy2wwkJHy6";
const RECAPTCHA_SITEKEY = "6LdLAasUAAAAAJIGrMFJ9wvf1UXIibLjHyeCZgH3";
const SIGNUP_URL = "https://giphy.com/join";
const CAPSOLVER_KEY = process.env.CAPSOLVER_API_KEY || "";

// Solve the giphy.com/join reCAPTCHA v2 via CapSolver. Returns the
// gRecaptchaResponse token, or null on failure.
async function solveRecaptcha() {
  if (!CAPSOLVER_KEY) {
    console.error("[giphy-key] BLOCKER: CAPSOLVER_API_KEY not in env. Export it from GCP Secret Manager first.");
    return null;
  }
  const post = (path, payload) => new Promise((res, rej) => {
    const data = JSON.stringify(payload);
    const r = httpsRequest({
      method: "POST", host: "api.capsolver.com", path,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
    }, (resp) => {
      let b = ""; resp.setEncoding("utf8");
      resp.on("data", (c) => b += c);
      resp.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    r.on("error", rej); r.write(data); r.end();
  });
  const create = await post("/createTask", {
    clientKey: CAPSOLVER_KEY,
    task: { type: "ReCaptchaV2TaskProxyLess", websiteURL: SIGNUP_URL, websiteKey: RECAPTCHA_SITEKEY },
  });
  if (create.errorId) {
    console.error(`[giphy-key] BLOCKER: CapSolver createTask error: ${create.errorCode} ${create.errorDescription}`);
    return null;
  }
  const taskId = create.taskId;
  console.log(`[giphy-key] CapSolver taskId=${taskId}, polling...`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const got = await post("/getTaskResult", { clientKey: CAPSOLVER_KEY, taskId });
    if (got.status === "ready") {
      const tok = got.solution?.gRecaptchaResponse;
      console.log(`[giphy-key] CapSolver solved (token ${tok ? tok.slice(0, 16) + "..." : "MISSING"})`);
      return tok || null;
    }
    if (got.errorId) {
      console.error(`[giphy-key] BLOCKER: CapSolver getTaskResult error: ${got.errorCode} ${got.errorDescription}`);
      return null;
    }
  }
  console.error("[giphy-key] BLOCKER: CapSolver timed out after 40 polls (~200s).");
  return null;
}

function randSlug() { return "fcp" + Math.random().toString(36).slice(2, 10); }
function randPassword() { return "G!" + Math.random().toString(36).slice(2, 14) + "Aa9"; }

const EMAIL_USER = `giphy-${randSlug()}`;
const EMAIL = `${EMAIL_USER}@wisentmedia.com`;
const PASSWORD = randPassword();
const USERNAME = `fcpagent${randSlug().slice(0, 8)}`;

console.log(`[giphy-key] email: ${EMAIL}`);
console.log(`[giphy-key] username: ${USERNAME}`);

async function run() {
  let chromium;
  try {
    ({ chromium } = await import(WELES_PLAYWRIGHT));
  } catch (e) {
    console.error("[giphy-key] FATAL: cannot load Playwright from weles node_modules. Path: " + WELES_PLAYWRIGHT);
    process.exit(2);
  }
  const sinceMs = Date.now();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  console.log("[giphy-key] step 1: open join page (giphy.com/join — React SPA)");
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=email], input[placeholder*='Email' i], input[name*='email' i]");

  const fieldNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input,textarea")).map((el) => ({
      name: el.name, id: el.id, type: el.type, placeholder: el.placeholder,
    })));
  console.log("[giphy-key] join page fields:", JSON.stringify(fieldNames));
  if (fieldNames.length === 0) {
    console.error("[giphy-key] BLOCKER: no form fields detected. URL: " + page.url());
    await browser.close();
    process.exit(4);
  }

  console.log("[giphy-key] step 2: fill signup form (email/username/password x2)");
  await page.fill("input[type=email], input[placeholder*='Email' i]", EMAIL);
  const userInput = await page.$("input[name=username], input[placeholder*='Username' i]");
  if (userInput) await userInput.fill(USERNAME);
  const pwFields = await page.$$("input[type=password]");
  for (const pf of pwFields) await pf.fill(PASSWORD);

  console.log("[giphy-key] step 3: solve reCAPTCHA via CapSolver");
  const token = await solveRecaptcha();
  if (!token) { await browser.close(); process.exit(3); }
  await page.evaluate((tok) => {
    let ta = document.querySelector("textarea#g-recaptcha-response, textarea[name='g-recaptcha-response']");
    if (!ta) {
      ta = document.createElement("textarea");
      ta.id = "g-recaptcha-response";
      ta.name = "g-recaptcha-response";
      ta.style.display = "none";
      document.body.appendChild(ta);
    }
    ta.value = tok;
    const cfg = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
    if (cfg) {
      for (const cid of Object.keys(cfg)) {
        const client = cfg[cid];
        for (const k of Object.keys(client)) {
          const o = client[k];
          if (o && typeof o === "object") {
            for (const kk of Object.keys(o)) {
              const oo = o[kk];
              if (oo && typeof oo.callback === "function") { try { oo.callback(tok); } catch (_) {} }
            }
          }
        }
      }
    }
  }, token);
  await page.waitForTimeout(1500);

  // CRITICAL: submit via Playwright locator.click() — NOT page.evaluate
  // el.click(). A JS .click() inside evaluate dispatches an isTrusted:false
  // DOM event; React form handlers + reCAPTCHA validation read that flag and
  // silently drop the submit (this is exactly why earlier runs stuck on
  // "Finish Sign Up"). locator.click() routes through CDP -> Blink
  // SetTrusted(true), the same path a human click takes.
  console.log("[giphy-key] step 4: submit via real (isTrusted) click");
  const signUpBtns = page.locator("button, input[type=submit]")
    .filter({ hasText: /sign\s*up|create account|join/i });
  const n = await signUpBtns.count();
  if (n === 0) { console.error("[giphy-key] BLOCKER: no Sign Up button"); await browser.close(); process.exit(8); }
  // force:true keeps the trusted CDP input dispatch (isTrusted:true) but
  // skips Playwright's occlusion check — the <form> overlays its own submit
  // button and "intercepts pointer events", which blocked the plain click.
  await signUpBtns.nth(n - 1).click({ force: true });
  console.log(`[giphy-key] submit clicked (${n} candidates, used last, force)`);
  await page.waitForTimeout(6000);

  // Nondeterministic React form: a stuck submit shows "Already started
  // creating an account? Finish Sign Up". Recover with forced trusted clicks.
  for (let r = 0; r < 4; r++) {
    const st = await page.evaluate(() => document.body.innerText.slice(0, 300));
    if (/check your email/i.test(st)) break;
    if (/finish sign\s*up/i.test(st)) {
      console.log(`[giphy-key] recovery ${r + 1}: Finish Sign Up (forced click)`);
      const fin = page.locator("text=/finish sign\\s*up/i").first();
      if (await fin.count()) await fin.click({ force: true });
    } else {
      console.log(`[giphy-key] recovery ${r + 1}: re-submit (forced click)`);
      const c = await signUpBtns.count();
      if (c) await signUpBtns.nth(c - 1).click({ force: true });
    }
    await page.waitForTimeout(5000);
  }

  const postSubmit = await page.evaluate(() => ({ url: location.href, head: document.body.innerText.slice(0, 200) }));
  console.log("[giphy-key] post-submit:", JSON.stringify(postSubmit));

  // Giphy emails a "Confirm Your GIPHY Account" link
  // (https://giphy.com/verify/registrant/<uuid>). Poll Resend, visit it in
  // THIS page so the verified session cookie is set on the same context the
  // dashboard OAuth flow reuses.
  console.log("[giphy-key] step 4b: poll Resend for confirmation email");
  const msg = await pollInbox(RESEND_KEY, EMAIL, sinceMs);
  if (!msg) {
    console.error("[giphy-key] BLOCKER: no confirmation email within 120s. URL: " + postSubmit.url);
    await browser.close(); process.exit(5);
  }
  console.log("[giphy-key] email id=" + msg.id + " subject=" + msg.subject);
  const full = await fetchEmailBody(RESEND_KEY, msg.id);
  const link = extractGiphyVerifyLink(full.html || full.text || JSON.stringify(full));
  if (!link) {
    console.error("[giphy-key] BLOCKER: no verify/registrant link. keys: " + Object.keys(full).join(","));
    await browser.close(); process.exit(6);
  }
  console.log("[giphy-key] step 4c: visit verify link " + link);
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("[giphy-key] post-verify url: " + page.url());

  console.log("[giphy-key] step 5: open developer dashboard (verified session)");
  await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  let dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 3000) }));
  console.log("[giphy-key] dashboard url:", dash.url);

  if (/log\s*in|sign\s*in/i.test(dash.body) && !/create.*app|api key/i.test(dash.body)) {
    console.log("[giphy-key] dashboard wants login — authenticating");
    const liEmail = await page.$("input[type=email], input[name=email], input[placeholder*='Email' i]");
    if (liEmail) {
      await liEmail.fill(EMAIL);
      const liPw = await page.$("input[type=password]");
      if (liPw) await liPw.fill(PASSWORD);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button, input[type=submit]"))
          .filter((x) => /log\s*in|sign\s*in/i.test(x.textContent || x.value));
        if (b.length) b[b.length - 1].click();
      });
      await page.waitForTimeout(5000);
      const authBtn = await page.$("text=/authorize|allow|continue/i");
      if (authBtn) { console.log("[giphy-key] OAuth authorize"); await authBtn.click(); await page.waitForTimeout(4000); }
      await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 3000) }));
    }
  }

  // Create an app if none exists yet (button text varies: "Create an App").
  // Dashboard CTA is "Create an API Key". The modal: App Name input, an
  // API-vs-SDK choice (we want API), and a "Create App" submit. The key
  // then renders on the dashboard as a 32-char token by the app name.
  const createBtn = await page.$("text=/create an api key/i");
  if (createBtn) {
    console.log("[giphy-key] step 6: Create an API Key");
    await createBtn.click();
    await page.waitForTimeout(2500);
    const nameField = await page.$("input[type=text], input[name*='name' i], input[placeholder*='App' i]");
    if (nameField) await nameField.fill("fcp-agent-broll");
    const apiCard = await page.$("text=/^\\s*API\\s*$/i");
    if (apiCard) await apiCard.click();
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button, input[type=submit]"))
        .filter((x) => /create app|create api key|create|confirm|submit/i.test(x.textContent || x.value));
      if (b.length) b[b.length - 1].click();
    });
    await page.waitForTimeout(5000);
    await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 4000) }));
  }

  console.log("[giphy-key] dashboard body head:", dash.body.slice(0, 800));
  const keyMatch = dash.body.match(/\b[a-zA-Z0-9]{32}\b/);
  if (!keyMatch) {
    console.error("[giphy-key] BLOCKER: dashboard did not surface an API key. Body above.");
    await browser.close();
    process.exit(7);
  }
  const apiKey = keyMatch[0];
  console.log("[giphy-key] extracted key (first 8): " + apiKey.slice(0, 8) + "...");
  let envBody = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  envBody = envBody.match(/^GIPHY_API_KEY=/m)
    ? envBody.replace(/^GIPHY_API_KEY=.*$/m, `GIPHY_API_KEY=${apiKey}`)
    : (envBody && !envBody.endsWith("\n") ? envBody + "\n" : envBody) + `GIPHY_API_KEY=${apiKey}\n`;
  writeFileSync(ENV_PATH, envBody);
  console.log("[giphy-key] wrote " + ENV_PATH);
  await browser.close();
}

run().catch((e) => {
  console.error("[giphy-key] FATAL: " + (e && e.stack || e));
  process.exit(1);
});
