/**
 * Matriz token x endpoint: sirve el token de app (id|secret) para la
 * WhatsApp Cloud API y para Instagram, o hace falta modo desarrollo / revision?
 */
const fs = require("fs");
const path = require("path");

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const GV = process.env.META_GRAPH_VERSION || "v27.0";
const TOKENS = {
  "app (id|secret)": `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
  "system user": process.env.META_ACCESS_TOKEN,
};
const ENDPOINTS = [
  ["/app", `${process.env.META_APP_ID}`, "fields=id,name"],
  ["/app/subscriptions", `${process.env.META_APP_ID}/subscriptions`, "fields=object,callback_url"],
  ["/ig cuenta", process.env.META_INSTAGRAM_ACCOUNT_ID, "fields=id,username,name"],
  ["/waba", process.env.META_WABA_ID, "fields=id,name,account_review_status"],
  ["/waba/phone_numbers", `${process.env.META_WABA_ID}/phone_numbers`, "fields=id,display_phone_number,code_verification_status,status"],
  ["/waba/message_templates", `${process.env.META_WABA_ID}/message_templates`, "fields=id,name,status,language"],
  ["/telefono", process.env.META_PHONE_NUMBER_ID, "fields=id,display_phone_number,code_verification_status,status"],
  ["/me/accounts", "me/accounts", "fields=id,name,account_type"],
];

async function g(p, token, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GV}/${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return await res.json().catch(() => ({}));
  } catch (e) {
    return { error: { message: e.message } };
  }
}

const color = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

(async () => {
  console.log("\nMatriz: que endpoint responde con que token\n");
  for (const [nombre, token] of Object.entries(TOKENS)) {
    console.log(`\x1b[1m${nombre}\x1b[0m`);
    for (const [label, p, params] of ENDPOINTS) {
      const b = await g(p, token, params);
      let res;
      if (b.error) res = red(`ERR ${String(b.error.message).slice(0, 80)}`);
      else if (b.data) res = color(`OK  ${JSON.stringify(b.data).slice(0, 110)}`);
      else res = color(`OK  ${JSON.stringify(b).slice(0, 110)}`);
      console.log(`  ${label.padEnd(24)} ${res}`);
    }
    console.log("");
  }
})();
