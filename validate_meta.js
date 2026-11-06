/**
 * Valida que la configuracion de Meta + x.ai este completa y funcionando.
 *
 *   node validate_meta.js
 *
 * Lee las variables desde el entorno. Para correrlo contra las variables de
 * Vercel sin exponerlas, usa el helper de shopify exec o exporta el .env.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

let fallos = 0;
let avisos = 0;

function ok(msg) {
  console.log(`  \x1b[32mOK\x1b[0m    ${msg}`);
}
function warn(msg) {
  avisos++;
  console.log(`  \x1b[33mAVISO\x1b[0m ${msg}`);
}
function fail(msg) {
  fallos++;
  console.log(`  \x1b[31mFALLA\x1b[0m ${msg}`);
}
function section(t) {
  console.log(`\n${t}`);
}

async function graph(path, token, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  const appSecret = process.env.META_APP_SECRET;
  const igId = process.env.META_INSTAGRAM_ACCOUNT_ID;
  const xaiKey = process.env.XAI_API_KEY;

  console.log("\n\x1b[1mValidacion de configuracion — Meta + x.ai\x1b[0m");

  section("1. Variables de entorno");
  const missing = [];
  if (!token || token === "PENDIENTE") missing.push("META_ACCESS_TOKEN");
  if (!appSecret || appSecret === "PENDIENTE") missing.push("META_APP_SECRET");
  if (!xaiKey || xaiKey === "PENDIENTE") missing.push("XAI_API_KEY");
  if (missing.length) {
    fail(`Faltan o siguen en PENDIENTE: ${missing.join(", ")}`);
    console.log("\nEjecuta: ./setup_meta_creds.sh");
    process.exit(1);
  }
  ok("META_ACCESS_TOKEN, META_APP_SECRET y XAI_API_KEY configurados");
  if (igId) ok(`META_INSTAGRAM_ACCOUNT_ID = ${igId} (modo /{id}/messages)`);
  else warn("META_INSTAGRAM_ACCOUNT_ID no definido (se usara /me/messages)");

  section("2. Token de Meta");
  const me = await graph("me", token, { fields: "id,name" });
  if (me.status === 200 && me.data.id) {
    ok(`Token valido —${me.data.id} ${me.data.name || ""}`);
  } else {
    fail(`Token rechazado (HTTP ${me.status}): ${me.data.error?.message || "sin detalle"}`);
    console.log("\n  Causas comunes:");
    console.log("   - Token expirado (los temporales duran ~60 dias o 24h segun el flujo)");
    console.log("   - Permisos insuficientes en el token");
    console.log("   - Token mal copiado (espacios, comillas)");
    process.exit(1);
  }

  section("3. Permisos del token");
  const perms = await graph("me/permissions", token);
  if (perms.status === 200 && Array.isArray(perms.data.data)) {
    const granted = perms.data.data.map((p) => p.permission);
    const needed = ["instagram_basic", "instagram_manage_messages"];
    for (const p of needed) {
      if (granted.includes(p)) ok(`permiso ${p}`);
      else fail(`permiso ${p} AUSENTE en el token`);
    }
    const extras = granted.filter((p) => p.startsWith("instagram_") || p.startsWith("pages_"));
    console.log(`         otros permisos: ${extras.join(", ") || "ninguno"}`);
  } else {
    warn(`No se pudieron leer los permisos (HTTP ${perms.status})`);
  }

  section("4. Cuenta de Instagram");
  const accounts = await graph("me/accounts", token, { fields: "id,name,access_token,tasks,instagram_business_account" });
  if (accounts.status === 200 && Array.isArray(accounts.data.data) && accounts.data.data.length) {
    for (const a of accounts.data.data) {
      const ig = a.instagram_business_account;
      ok(`Page "${a.name}" (${a.id}) — tasks: ${(a.tasks || []).join(", ")}`);
      if (ig) ok(`  Instagram vinculado: ${ig.id} (@${ig.username})`);
      else warn(`  La Page "${a.name}" no tiene Instagram vinculado`);
    }
    if (!igId) {
      const first = accounts.data.data[0];
      const ig = first.instagram_business_account;
      if (ig) {
        console.log(
          `\n  Sugerencia: agrega META_INSTAGRAM_ACCOUNT_ID=${ig.id} a Vercel`
        );
      }
    }
  } else {
    warn(`No se listaron Pages (HTTP ${accounts.status}). ${accounts.data.error?.message || ""}`);
    console.log("         Si tu IG esta en Unified Login, el token puede no tener Pages.");
  }

  section("5. API key de x.ai");
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${xaiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.data)) {
      const ids = data.data.map((m) => m.id);
      ok(`x.ai responde — ${ids.length} modelos disponibles`);
      const model = process.env.XAI_MODEL || "grok-4.7";
      if (ids.includes(model)) ok(`modelo "${model}" disponible`);
      else warn(`modelo "${model}" no aparece en la lista (usa: ${ids.slice(0, 3).join(", ")})`);
    } else {
      fail(`x.ai rechazo la key (HTTP ${res.status}): ${data.error?.message || "sin detalle"}`);
    }
  } catch (error) {
    fail(`No se pudo conectar con x.ai: ${error.message}`);
  }

  section("6. Webhooks en produccion");
  const BASE = "https://envia-webhook.vercel.app";
  const vt = process.env.META_VERIFY_TOKEN;

  for (const [label, path] of [
    ["Instagram", "/webhook/instagram"],
    ["WhatsApp", "/webhook/meta"],
  ]) {
    if (!vt) {
      warn(`META_VERIFY_TOKEN no disponible para probar ${label}`);
      continue;
    }
    const url = `${BASE}${path}?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=VALIDATION_TEST`;
    const res = await fetch(url);
    const body = (await res.text()).trim();
    if (res.status === 200 && body === "VALIDATION_TEST") {
      ok(`${label} — handshake responde el challenge correctamente`);
    } else {
      fail(`${label} — handshake devolvio HTTP ${res.status}: ${body.slice(0, 60)}`);
    }
  }

  section("Resumen");
  console.log(`  ${fallos} fallo(s), ${avisos} aviso(s)`);
  if (failos === 0) {
    console.log("\n  \x1b[32m\x1b[1mConfiguracion completa.\x1b[0m Ya puedes probar un DM real.");
    console.log("  Recuerda: el toggle 'Permitir acceso a los mensajes' debe estar ON en el Instagram del telefono.");
  }
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
