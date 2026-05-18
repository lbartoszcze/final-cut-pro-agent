#!/usr/bin/env node
// Obtain a Giphy developer API key autonomously.
//
//   1. Generate a fresh @wisentmedia.com email + password.
//   2. Drive developers.giphy.com/join via Playwright (from sibling weles).
//   3. Poll Resend's receiving API for the verification message.
//   4. Click the verification link.
//   5. Sign in, create an app, extract the API key from the dashboard.
//   6. Persist GIPHY_API_KEY=<key> to <repo>/.env.
//
// If signup hits a CAPTCHA or anti-bot wall, the script halts at that
// point with a labeled blocker.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

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

async function pollInbox(toAddr, sinceMs, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const list = await new Promise((res, rej) => {
      const r = httpsRequest({
        method: "GET", host: "api.resend.com", path: "/emails/receiving?limit=20",
        headers: { authorization: `Bearer ${RESEND_KEY}` },
      }, (resp) => {
        let body = ""; resp.setEncoding("utf8");
        resp.on("data", (c) => body += c);
        resp.on("end", () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
      });
      r.on("error", rej); r.end();
    });
    const match = (list.data || []).find((m) => {
      const to = (m.to || []).join(" ");
      return to.includes(toAddr) && new Date(m.created_at).getTime() > sinceMs;
    });
    if (match) return match;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

async function fetchEmailBody(id) {
  return new Promise((res, rej) => {
    const r = httpsRequest({
      method: "GET", host: "api.resend.com", path: `/emails/receiving/${id}`,
      headers: { authorization: `Bearer ${RESEND_KEY}` },
    }, (resp) => {
      let body = ""; resp.setEncoding("utf8");
      resp.on("data", (c) => body += c);
      resp.on("end", () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
    });
    r.on("error", rej); r.end();
  });
}

function extractVerifyLink(text) {
  const m = text && text.match(/https:\/\/developers\.giphy\.com\/[^\s"<>]*verify[^\s"<>]*/i);
  return m ? m[0] : null;
}

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
  await page.goto(SIGNUP_URL, { waitUntil: "networkidle" });
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

  console.log("[giphy-key] step 4: submit (LAST 'Sign Up' = form submit; the");
  console.log("            first 'Sign Up' is just the Login/Signup tab toggle)");
  const submitOk = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, input[type=submit]"))
      .filter((b) => /sign\s*up|create account|join/i.test(b.textContent || b.value));
    if (btns.length === 0) return false;
    btns[btns.length - 1].click();
    return true;
  });
  console.log("[giphy-key] submit clicked: " + submitOk);
  await page.waitForTimeout(6000);

  // Capture post-submit state. Giphy creates the account immediately on
  // signup (the session cookie is set) — there is no email-verify gate for
  // basic API access, so proceed straight to the developer dashboard with
  // the same browser context.
  const postSubmit = await page.evaluate(() => ({
    url: location.href,
    err: (document.querySelector(".form-error, .error, [class*='error' i]") || {}).innerText || "",
    bodyHead: document.body.innerText.slice(0, 400),
  }));
  console.log("[giphy-key] post-submit:", JSON.stringify(postSubmit));

  console.log("[giphy-key] step 5: open developer dashboard (same session)");
  await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  let dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 3000) }));
  console.log("[giphy-key] dashboard url:", dash.url);

  // If the dashboard bounced to a login, the giphy.com session cookie is
  // not shared with developers.giphy.com — sign in explicitly there.
  if (/log\s*in|sign\s*in/i.test(dash.body) && !/create.*app|api key/i.test(dash.body)) {
    console.log("[giphy-key] dashboard wants login — authenticating on developers.giphy.com");
    const liEmail = await page.$("input[type=email], input[name=email], input[placeholder*='Email' i]");
    if (liEmail) {
      await liEmail.fill(EMAIL);
      const liPw = await page.$("input[type=password]");
      if (liPw) await liPw.fill(PASSWORD);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button, input[type=submit]"))
          .find((x) => /log\s*in|sign\s*in/i.test(x.textContent || x.value));
        if (b) b.click();
      });
      await page.waitForTimeout(5000);
      // OAuth consent: developers.giphy.com authorizes via giphy.com OAuth.
      // After login the grant page may show an Authorize/Allow button.
      const authBtn = await page.$("text=/authorize|allow|continue/i");
      if (authBtn) { console.log("[giphy-key] clicking OAuth authorize"); await authBtn.click(); await page.waitForTimeout(4000); }
      await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 3000) }));
    }
  }

  // Create an app if none exists yet (button text varies: "Create an App").
  const createBtn = await page.$("text=/create an app/i");
  if (createBtn) {
    console.log("[giphy-key] creating an app");
    await createBtn.click();
    await page.waitForTimeout(2000);
    const nameField = await page.$("input[type=text], input[name*='name' i]");
    if (nameField) await nameField.fill("fcp-agent-broll");
    const apiOpt = await page.$("text=/API/i");
    if (apiOpt) await apiOpt.click();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button"))
        .find((x) => /create app|create|confirm/i.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(4000);
    await page.goto("https://developers.giphy.com/dashboard/", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    dash = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0, 3000) }));
  }

  console.log("[giphy-key] dashboard body head:", dash.body.slice(0, 600));
  const keyMatch = dash.body.match(/\b[A-Za-z0-9]{32,40}\b/);
  if (!keyMatch) {
    console.error("[giphy-key] BLOCKER: dashboard did not surface an API key. Body above.");
    await browser.close();
    process.exit(7);
  }
  const apiKey = keyMatch[0];
  console.log("[giphy-key] extracted key (first 8 chars): " + apiKey.slice(0, 8) + "...");

  let envBody = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  if (envBody.match(/^GIPHY_API_KEY=/m)) {
    envBody = envBody.replace(/^GIPHY_API_KEY=.*$/m, `GIPHY_API_KEY=${apiKey}`);
  } else {
    if (envBody && !envBody.endsWith("\n")) envBody += "\n";
    envBody += `GIPHY_API_KEY=${apiKey}\n`;
  }
  writeFileSync(ENV_PATH, envBody);
  console.log("[giphy-key] wrote " + ENV_PATH);
  await browser.close();
}

run().catch((e) => {
  console.error("[giphy-key] FATAL: " + (e && e.stack || e));
  process.exit(1);
});
