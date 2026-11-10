/**
 * Estado de la app de Meta y del token, usando el token de la app (id|secret).
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
const APPTOKEN = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;

async function graph(pathname, params = {}, token = APPTOKEN) {
  const url = new URL(`https://graph.facebook.com/${GV}/${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ok = (m) => `   \x1b[32mOK\x1b[0m    ${m}`;
const bad = (m) => `   \x1b[31mFALLA\x1b[0m ${m}`;
const warn = (m) => `   \x1b[33m? \x1b[0m    ${m}`;

(async () => {
  console.log("1) La app (token de app id|secret)");
  const app = await graph(process.env.META_APP_ID, { fields: "id,name,link,category,description" });
  console.log(app.body?.id ? ok(`id=${app.body.id} "${app.body.name}" link=${app.body.link}`) : bad(JSON.stringify(app.body).slice(0, 200)));

  console.log("\n2) Permisos de la app (los que ya tiene)");
  const perms = await graph(`${process.env.META_APP_ID}/permissions`);
  const lista = perms.body?.data || [];
  if (!lista.length) {
    console.log(bad(`no se pueden listar: ${JSON.stringify(perms.body).slice(0, 200)}`));
  } else {
    for (const p of lista) {
      const esWa = /whatsapp/i.test(p.permission);
      console.log(`   ${p.status === "granted" ? "concedido" : p.status}  ${p.permission}${esWa ? "   <-- WhatsApp" : ""}`);
    }
    const wa = lista.filter((p) => /whatsapp/i.test(p.permission));
    console.log(
      wa.length
        ? ok(`permisos de WhatsApp en la app: ${wa.map((p) => p.permission + "=" + p.status).join(", ")}`)
        : bad("la app NO tiene permisos de WhatsApp: hay que anadirlos")
    );
  }

  console.log("\n3) Token del system user (el que esta en Vercel)");
  const dbg = await graph("debug_token", {
    input_token: process.env.META_ACCESS_TOKEN,
    fields: "app_id,type,scopes,is_valid,data_access_expires_at,expires_at,granular_scopes",
  });
  const d = dbg.body?.data || {};
  if (d.error) {
    console.log(bad(`debug_token: ${d.error.message}`));
  } else {
    console.log(ok(`app_id=${d.app_id} tipo=${d.type} valido=${d.is_valid}`));
    console.log(`   scopes: ${(d.scopes || []).join(", ")}`);
    console.log(`   expira: ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "n/d"}`);
    const falta = ["whatsapp_business_messaging", "whatsapp_business_management"].filter(
      (s) => !(d.scopes || []).includes(s)
    );
    console.log(falta.length ? bad(`faltan scopes: ${falta.join(", ")}`) : ok("tiene los scopes de WhatsApp"));
  }

  console.log("\n4) Token de app sirve para enviar por WhatsApp Cloud API?");
  console.log("   El token de app (id|secret) se puede usar en Development mode,");
  console.log("   pero solo con numeros y usuarios que sean rol de la app.");
})();
