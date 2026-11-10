/**
 * Test del modo desarrollo: mide si la app sigue funcionando con cada token
 * y deja el resultado comparable antes/despues del cambio de modo.
 *
 *   node scripts/test_modo_desarrollo.js
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
const APP = process.env.META_APP_ID;
const SECRET = process.env.META_APP_SECRET;
const APP_TOKEN = `${APP}|${SECRET}`;
const SYS_TOKEN = process.env.META_ACCESS_TOKEN;
const WABA = process.env.META_WABA_ID;
const PHONE = process.env.META_PHONE_NUMBER_ID;
const IG = process.env.META_INSTAGRAM_ACCOUNT_ID;

async function g(pathname, token, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GV}/${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, body: { error: { message: e.message } } };
  }
}

const ok = (m) => `   \x1b[32mOK\x1b[0m    ${m}`;
const bad = (m) => `   \x1b[31mFALLA\x1b[0m ${m}`;
const warn = (m) => `   \x1b[33m? \x1b[0m    ${m}`;

(async () => {
  const stamp = new Date().toISOString();
  console.log(`\x1b[1mTest de modo desarrollo — ${stamp}\x1b[0m`);
  console.log(`app ${APP} | waba ${WABA} | ig ${IG} | phone ${PHONE}\n`);

  const R = {};

  console.log("A) Instagram con el token del SYSTEM USER (el que usa el bot hoy)");
  R.ig_sys = await g(IG, SYS_TOKEN, { fields: "id,username,name,followers_count" });
  console.log(
    R.ig_sys.body?.id
      ? ok(`lee la cuenta @${R.ig_sys.body.username} (${R.ig_sys.body.name})`)
      : bad(`no puede leer la cuenta: ${JSON.stringify(R.ig_sys.body?.error?.message).slice(0, 130)}`)
  );

  console.log("\nB) Instagram con el token de APP (id|secret)");
  R.ig_app = await g(IG, APP_TOKEN, { fields: "id,username,name" });
  console.log(
    R.ig_app.body?.id
      ? ok(`lee la cuenta @${R.ig_app.body.username}`)
      : bad(`no puede leer la cuenta: ${JSON.stringify(R.ig_app.body?.error?.message).slice(0, 130)}`)
  );

  console.log("\nC) Envio de DM por Instagram (no se envia nada, solo permisos)");
  R.ig_perm = await g(`${IG}/message_threads`, SYS_TOKEN, { fields: "id" });
  console.log(
    R.ig_perm.body?.data
      ? ok(`puede leer los hilos de mensajes (${R.ig_perm.body.data.length})`)
      : warn(`sin acceso a message_threads: ${JSON.stringify(R.ig_perm.body?.error?.message).slice(0, 120)}`)
  );

  console.log("\nD) WhatsApp (WABA) con el token de APP");
  R.wa_app = await g(WABA, APP_TOKEN, { fields: "id,name,account_review_status" });
  console.log(
    R.wa_app.body?.id
      ? ok(`accede al WABA "${R.wa_app.body.name}" (revision: ${R.wa_app.body.account_review_status})`)
      : bad(`sin acceso: ${JSON.stringify(R.wa_app.body?.error?.message).slice(0, 130)}`)
  );

  console.log("\nE) WhatsApp (WABA) con el token del SYSTEM USER");
  R.wa_sys = await g(WABA, SYS_TOKEN, { fields: "id,name" });
  console.log(
    R.wa_sys.body?.id
      ? ok(`accede al WABA "${R.wa_sys.body.name}"`)
      : bad(`sin acceso: ${JSON.stringify(R.wa_sys.body?.error?.message).slice(0, 130)}`)
  );

  console.log("\nF) Numeros de telefono del WABA (token de app)");
  R.phones = await g(`${WABA}/phone_numbers`, APP_TOKEN, {
    fields: "id,display_phone_number,code_verification_status,status",
  });
  if (R.phones.body?.data?.length) {
    for (const p of R.phones.body.data) {
      console.log(
        `   ${p.display_phone_number} | verificacion: ${p.code_verification_status} | estado: ${p.status}`
      );
    }
    const verificados = R.phones.body.data.filter((p) => p.code_verification_status === "VERIFIED");
    console.log(verificados.length ? ok(`${verificados.length} numero(s) verificado(s)`) : warn("ningun numero verificado todavia"));
  } else {
    console.log(bad(`no se pudieron listar: ${JSON.stringify(R.phones.body?.error?.message).slice(0, 130)}`));
  }

  console.log("\nG) Suscripcion al webhook de la app");
  const sub = await g(`${APP}/subscriptions`, APP_TOKEN, { fields: "object,callback_url,fields" });
  if (sub.body?.data?.length) {
    for (const s of sub.body.data) console.log(ok(`${s.object} -> ${s.callback_url} campos=[${(s.fields || []).join(",")}]`));
  } else {
    console.log(warn(`sin suscripciones visibles: ${JSON.stringify(sub.body?.error?.message || sub.body).slice(0, 120)}`));
  }

  const resumen = {
    stamp,
    ig_sys_ok: !!R.ig_sys.body?.id,
    ig_app_ok: !!R.ig_app.body?.id,
    wa_app_ok: !!R.wa_app.body?.id,
    wa_sys_ok: !!R.wa_sys.body?.id,
    telefonos: (R.phones.body?.data || []).map((p) => ({
      num: p.display_phone_number,
      verificacion: p.code_verification_status,
      estado: p.status,
    })),
  };
  const out = path.join(__dirname, "..", "docs", "test-modo-desarrollo.json");
  fs.appendFileSync(out, JSON.stringify(resumen) + "\n");
  console.log(`\n   (resultado anexado a ${out})`);
})();
