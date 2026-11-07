#!/usr/bin/env node
/**
 * Configura la integracion de WhatsApp/Instagram Cloud API para una tienda.
 *
 * Uso:
 *   node scripts/setup_meta_integration.js
 *
 * Requiere en .env (o en el entorno):
 *   META_ACCESS_TOKEN       token del System User con los scopes de messaging
 *   META_APP_ID             id numerico de la app de Meta
 *
 * Que hace:
 *   1. Verifica los scopes del token (instagram_manage_messages y
 *      pages_manage_metadata son los minimos para webhooks de Instagram).
 *   2. Descubre el ig-user-id de la cuenta si se pasa como argumento.
 *   3. Suscribe la app a los webhooks de la cuenta de Instagram.
 *      Este paso es OBLIGATORIO en la ruta Unified Login: guardar la URL del
 *      webhook en el panel no suscribe la cuenta por sí sola.
 *   4. Muestra el estado final.
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_seen",
  "message_reactions",
  "messaging_referral",
  "comments",
  "live_comments",
  "mentions",
];

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

async function main() {
  loadEnv();

  const token = process.env.META_ACCESS_TOKEN;
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
    const ok = granted.includes(r);
    console.log(`   ${ok ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFALTA\x1b[0m"}  ${r}`);
  }
  console.log(`   scopes: ${granted.join(", ")}`);

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
      console.log(`   \x1b[32mOK\x1b[0m  ${igUserId} = @${check.body.username}`);
    } else {
      console.log(`   \x1b[33m? \x1b[0m  ${igUserId} -> ${check.body?.error?.message || "sin username"}`);
    }
  }

  // 3) Suscripcion a webhooks
  if (igUserId) {
    console.log("\n3) Suscribiendo la app a los webhooks...");
    const res = await graph(`${igUserId}/subscribed_apps`, {
      method: "POST",
      params: { subscribed_fields: SUBSCRIBED_FIELDS.join(",") },
    });
    if (res.body?.success) {
      console.log(`   \x1b[32mOK\x1b[0m  suscrito a: ${SUBSCRIBED_FIELDS.join(", ")}`);
    } else {
      console.log(`   \x1b[31mFALLA\x1b[0m ${res.body?.error?.message || JSON.stringify(res.body)}`);
    }
  }

  // 4) Estado final
  if (igUserId) {
    console.log("\n4) Estado final:");
    const sub = await graph(`${igUserId}/subscribed_apps`, {
      params: { fields: "subscribed_fields" },
    });
    const fields = sub.body?.data?.[0]?.subscribed_fields;
    console.log(
      fields?.length
        ? `   \x1b[32mOK\x1b[0m  campos suscritos: ${fields.join(", ")}`
        : `   \x1b[31mSIN SUSCRIPCION\x1b[0m ${JSON.stringify(sub.body)}`
    );
  }

  console.log(
    "\nListo. Recuerda: la URL del webhook debe estar guardada en el panel de Meta\n" +
      "(App dashboard > tu app > WhatsApp/Instagram > Configuration > Webhooks)\n" +
      "con el mismo verify token que META_VERIFY_TOKEN en el servidor.\n"
  );
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
