/**
 * Diagnostico: que se puede leer/escribir hoy con el token actual de Meta,
 * y que falta para poder probar WhatsApp de punta a punta.
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const GV = process.env.META_GRAPH_VERSION || "v27.0";
let TOKEN = process.env.META_ACCESS_TOKEN;
let WABA = process.env.META_WABA_ID;
let PHONE = process.env.META_PHONE_NUMBER_ID;
let APP = process.env.META_APP_ID;

async function graph(p, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GV}/${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", TOKEN);
  const res = await fetch(url, { method: params.method || "GET" });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const ok = (m) => `   \x1b[32mOK\x1b[0m    ${m}`;
const bad = (m) => `   \x1b[31mFALLA\x1b[0m ${m}`;
const info = (m) => `   \x1b[36mINFO\x1b[0m  ${m}`;

(async () => {
  loadEnv();
  // Las constantes se leen arriba, pero .env todavia no estaba cargado:
  // se vuelven a leer ahora.
  TOKEN = process.env.META_ACCESS_TOKEN;
  WABA = process.env.META_WABA_ID;
  PHONE = process.env.META_PHONE_NUMBER_ID;
  APP = process.env.META_APP_ID;
  console.log(`Graph API ${GV} | app ${APP} | waba ${WABA} | phone ${PHONE}\n`);

  console.log("1) Identidad del token");
  const me = await graph("me", { fields: "id,name" });
  console.log(me.body.id ? ok(`token de ${me.body.id} (${me.body.name})`) : bad(`token invalido: ${JSON.stringify(me.body).slice(0, 150)}`));

  console.log("\n2) Scopes del token");
  const scopes = await graph("me/permissions");
  const granted = (scopes.body?.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
  console.log(`   ${granted.length} scopes: ${granted.join(", ")}`);
  const need = ["whatsapp_business_messaging", "whatsapp_business_management"];
  for (const s of need) {
    console.log(granted.includes(s) ? ok(s) : bad(`${s}  <- FALTA`));
  }

  console.log("\n3) Cuentas de WhatsApp visibles con el token");
  const wa = await graph("me/whatsapp_accounts", { fields: "id,name,phone_numbers{id,display_phone_number,code_verification_status,status}" });
  if (wa.body?.data?.length) {
    for (const w of wa.body.data) {
      console.log(ok(`waba ${w.id} "${w.name}"`));
      for (const p of w.phone_numbers || []) {
        console.log(`        numero ${p.id} ${p.display_phone_number} | verif: ${p.code_verification_status} | estado: ${p.status}`);
      }
    }
  } else {
    console.log(bad(`no se pueden listar las cuentas: ${JSON.stringify(wa.body).slice(0, 160)}`));
  }

  console.log("\n4) El WABA y el numero que hay en el .env");
  const w1 = await graph(`${WABA}`, { fields: "id,name,account_review_status,phone_numbers{id,display_phone_number,code_verification_status,status}" });
  if (w1.body?.id) {
    console.log(ok(`waba ${w1.body.id} "${w1.body.name}" | revision: ${w1.body.account_review_status}`));
    for (const p of w1.body.phone_numbers || []) {
      console.log(`        numero ${p.id} ${p.display_phone_number} | verif: ${p.code_verification_status} | estado: ${p.status}`);
    }
  } else {
    console.log(bad(`no accesible: ${JSON.stringify(w1.body).slice(0, 200)}`));
  }
  const ph = await graph(`${PHONE}`, { fields: "id,display_phone_number,code_verification_status,status,name" });
  if (ph.body?.id) {
    console.log(ok(`telefono ${ph.body.id} ${ph.body.display_phone_number} | verif: ${ph.body.code_verification_status} | estado: ${ph.body.status}`));
  } else {
    console.log(bad(`telefono no accesible: ${JSON.stringify(ph.body).slice(0, 200)}`));
  }

  console.log("\n5) Suscripcion al webhook (app y WABA)");
  const sub = await graph(`${APP}/subscriptions`, { fields: "object,callback_url,fields,verify_token" });
  if (sub.body?.data?.length) {
    for (const s of sub.body.data) {
      console.log(ok(`${s.object}: ${s.callback_url} campos=[${(s.fields || []).join(",")}]`));
    }
  } else {
    console.log(bad(`sin suscripciones visibles: ${JSON.stringify(sub.body).slice(0, 200)}`));
  }

  console.log("\n6) Plantillas de mensajes del WABA (para avisos proactivos)");
  const tpl = await graph(`${WABA}/message_templates`, { fields: "id,name,status,language,category" });
  if (tpl.body?.data?.length) {
    for (const t of tpl.body.data) console.log(ok(`${t.name} [${t.status}] ${t.language} (${t.category})`));
  } else {
    console.log(bad(`no se pueden listar: ${JSON.stringify(tpl.body).slice(0, 200)}`));
  }

  console.log("\n7) Token de la app (para /debug_tokens)");
  console.log(info("Se necesita un token de app (system user) para verificar permisos y diagnosticar tokens de larga vida."));
})();
