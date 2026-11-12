#!/usr/bin/env node
/**
 * Muestra la configuracion de webhooks de la app de Meta.
 *
 * Cada caso de uso (object) tiene SU PROPIA callback URL, asi que Instagram
 * y WhatsApp pueden vivir en endpoints distintos sin Tocarse.
 *
 *   node scripts/ver_webhooks.js
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

(async () => {
  loadEnv();
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const token = `${appId}|${appSecret}`;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions?` +
    new URLSearchParams({
      fields: "object,callback_url,fields",
      access_token: token,
    });

  const data = await fetch(url).then((r) => r.json());

  console.log("\n\x1b[1mWebhooks de la app\x1b[0m");
  if (data.error) {
    console.log("  ERROR:", data.error.message);
    return;
  }
  for (const s of data.data || []) {
    console.log(`\n  object: ${s.object}`);
    console.log(`    callback_url: ${s.callback_url}`);
    console.log(`    campos: ${(s.fields || []).map((f) => f.name).join(", ")}`);
  }
  console.log(
    "\n  Cada caso de uso tiene su propia URL: cambiar una no afecta a la otra.\n"
  );
})();
