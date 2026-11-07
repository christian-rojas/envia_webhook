#!/usr/bin/env node
/**
 * Configura la integracion de WhatsApp/Instagram Cloud API para una tienda.
 *
 * Uso:
 *   node scripts/setup_meta_integration.js [ig-user-id]
 *
 * Requiere en .env (o en el entorno):
 *   META_ACCESS_TOKEN     token del System User con los scopes de messaging
 *   META_APP_ID           id numerico de la app de Meta
 *   META_APP_SECRET       secret de la app (para el app access token)
 *   META_VERIFY_TOKEN     token de verificacion del webhook
 *
 * Que hace:
 *   1. Verifica los scopes del token (instagram_manage_messages y
 *      pages_manage_metadata son los minimos para webhooks de Instagram).
 *   2. Descubre el ig-user-id de la cuenta si se pasa como argumento.
 *   3. Suscribe la app a nivel de APP (POST /{app-id}/subscriptions) con la
 *      URL del webhook y el campo "messages".
 *      Sin esto la app recibe CERO eventos aunque la URL este guardada:
 *      una suscripcion sin campos no entrega nada.
 *   4. Suscribe la app a nivel de CUENTA (POST /{ig-user-id}/subscribed_apps).
 *   5. Muestra el estado final.
 *
 * IMPORTANTE: si cambias META_ACCESS_TOKEN, hay que publicarlo en Vercel:
 *   vercel env add META_ACCESS_TOKEN production --value "<token>" \
 *     --project <proyecto> --sensitive --force --yes
 *   vercel deploy --prod --yes
 * Un token viejo en el servidor produce el error
 *   (#100) No se puede encontrar al usuario solicitado  (subcode 2534014)
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const APP_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_seen",
  "message_reactions",
  "messaging_referral",
];
const ACCOUNT_FIELDS = [...APP_FIELDS, "comments", "live_comments", "mentions"];

// Carga el .env sin dependencias externas
function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

async function graph(path, { method = "GET", params = {}, token } = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token || process.env.META_ACCESS_TOKEN);
  const res = await fetch(url, { method });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const ok = (msg) => `   \x1b[32mOK\x1b[0m  ${msg}`;
const bad = (msg) => `   \x1b[31mFALLA\x1b[0m ${msg}`;
const warn = (msg) => `   \x1b[33m? \x1b[0m  ${msg}`;

async function main() {
  loadEnv();

  const token = process.env.META_ACCESS_TOKEN;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const igUserId = process.argv[2] || process.env.META_INSTAGRAM_ACCOUNT_ID;

  if (!token) {
    console.error("Falta META_ACCESS_TOKEN (en .env o como variable de entorno).");
    process.exit(1);
  }

  console.log("\n\x1b[1mSetup de la integracion Meta (Instagram / WhatsApp)\x1b[0m");

  // 1) Scopes
  console.log("\n1) Verificando scopes del token...");
  const perms = await graph("me/permissions");
  const granted = (perms.body?.data || []).map((p) => p.permission);
  const required = ["instagram_manage_messages", "pages_manage_metadata"];
  for (const r of required) {
    console.log(
      granted.includes(r) ? ok(r) : bad(`${r}  <- falta este scope`)
    );
  }
  console.log(`   scopes: ${granted.join(", ") || "(ninguno)"}`);

  // 2) ig-user-id
  console.log("\n2) ig-user-id de la cuenta...");
  if (!igUserId) {
    console.log(
      "   \x1b[33mNo indicado\x1b[0m. Pasalo como argumento:\n" +
        "     node scripts/setup_meta_integration.js <ig-user-id>\n" +
        "   Se encuentra en Instagram > API setup, o en el entry[0].id de un webhook."
    );
  } else {
    const check = await graph(igUserId, { params: { fields: "id,username" } });
    if (check.body?.username) {
      console.log(ok(`${igUserId} = @${check.body.username}`));
    } else {
      console.log(warn(`${igUserId} -> ${check.body?.error?.message || "sin username"}`));
    }
  }

  // 3) Suscripcion a nivel de APP (la que realmente faltaba)
  if (appId && appSecret) {
    const appToken = `${appId}|${appSecret}`;
    console.log("\n3) Suscribiendo la app (nivel app) con la URL del webhook...");
    const res = await graph(`${appId}/subscriptions`, {
      method: "POST",
      token: appToken,
      params: {
        object: "instagram",
        callback_url: "https://envia-webhook.vercel.app/webhook/instagram",
        verify_token: verifyToken || "MON-VERIFY",
        fields: APP_FIELDS.join(","),
      },
    });
    if (res.body?.success) {
      console.log(ok(`callback_url + campos: ${APP_FIELDS.join(", ")}`));
    } else {
      console.log(bad(res.body?.error?.message || JSON.stringify(res.body)));
    }
  } else {
    console.log(
      "\n3) Suscripcion a nivel de app: OMITIDA (faltan META_APP_ID o META_APP_SECRET)"
    );
  }

  // 4) Suscripcion a nivel de CUENTA
  if (igUserId) {
    console.log("\n4) Suscribiendo la app (nivel cuenta)...");
    const res = await graph(`${igUserId}/subscribed_apps`, {
      method: "POST",
      params: { subscribed_fields: ACCOUNT_FIELDS.join(",") },
    });
    if (res.body?.success) {
      console.log(ok(`suscrito a: ${ACCOUNT_FIELDS.join(", ")}`));
    } else {
      console.log(bad(res.body?.error?.message || JSON.stringify(res.body)));
    }
  }

  // 5) Estado final
  console.log("\n5) Estado final:");
  if (appId && appSecret) {
    const sub = await graph(`${appId}/subscriptions`, {
      token: `${appId}|${appSecret}`,
      params: { fields: "object,callback_url,fields" },
    });
    const s = sub.body?.data?.[0];
    const fields = (s?.fields || []).map((f) => f.name);
    console.log(`   callback_url: ${s?.callback_url || "(sin URL)"}`);
    console.log(
      fields.length
        ? ok(`campos suscritos: ${fields.join(", ")}`)
        : bad(`sin campos suscritos ${JSON.stringify(sub.body)}`)
    );
  }
  if (igUserId) {
    const sub = await graph(`${igUserId}/subscribed_apps`, {
      params: { fields: "subscribed_fields" },
    });
    const fields = sub.body?.data?.[0]?.subscribed_fields;
    console.log(
      fields?.length
        ? ok(`cuenta: ${fields.join(", ")}`)
        : bad(`cuenta sin suscripcion ${JSON.stringify(sub.body)}`)
    );
  }

  console.log(
    "\nListo. La app ya esta suscrita; Meta valida la URL con un GET de\n" +
      "verificacion y a partir de ahi entrega los eventos en /webhook/instagram.\n" +
      "Si acabas de cambiar META_ACCESS_TOKEN, publicalo en Vercel:\n" +
      "  vercel env add META_ACCESS_TOKEN production --value \"<token>\" \\\n" +
      "    --project <proyecto> --sensitive --force --yes\n" +
      "  vercel deploy --prod --yes\n"
  );
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
