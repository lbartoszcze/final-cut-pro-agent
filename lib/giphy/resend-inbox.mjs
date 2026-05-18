// Resend receiving-API inbox helpers for the Giphy key obtainer.
// Pure HTTP + parsing; the caller supplies the Resend receiving key.

import { request as httpsRequest } from "node:https";

function resendGet(resendKey, path) {
  return new Promise((res, rej) => {
    const r = httpsRequest({
      method: "GET", host: "api.resend.com", path,
      headers: { authorization: `Bearer ${resendKey}` },
    }, (resp) => {
      let body = ""; resp.setEncoding("utf8");
      resp.on("data", (c) => body += c);
      resp.on("end", () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
    });
    r.on("error", rej); r.end();
  });
}

// Poll /emails/receiving until a message addressed to `toAddr` and created
// after `sinceMs` appears, or maxWaitMs elapses. Returns the match or null.
export async function pollInbox(resendKey, toAddr, sinceMs, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const list = await resendGet(resendKey, "/emails/receiving?limit=20");
    const match = (list.data || []).find((m) => {
      const to = (m.to || []).join(" ");
      return to.includes(toAddr) && new Date(m.created_at).getTime() > sinceMs;
    });
    if (match) return match;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

export async function fetchEmailBody(resendKey, id) {
  return resendGet(resendKey, `/emails/receiving/${id}`);
}

// Giphy's confirmation link is https://giphy.com/verify/registrant/<uuid>.
export function extractGiphyVerifyLink(text) {
  const m = text && text.match(/https:\/\/giphy\.com\/verify\/registrant\/[0-9a-f-]+/i);
  return m ? m[0] : null;
}
