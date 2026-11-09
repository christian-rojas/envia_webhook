#!/usr/bin/env node
/**
 * Reintenta pedir el codigo de verificacion por SMS del numero de WhatsApp.
 *
 * Meta a veces responde "Our servers are temporarily unavailable. Please
 * wait 1 hour before trying again" cuando su servicio de SMS esta saturado.
 * Este script reintenta solo cada若干 minutos hasta que lo acepte.
 *
 *   node scripts/verificar_numero.js            # reintenta cada 10 min
 *   node scripts/verificar_numero.js --once     # un solo intento
 *
 * Cuando el codigo llega al celular, se verifica con:
 *   node scripts/setup_whatsapp.js <waba> <phone_number_id> --verify-code <CODIGO>
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || "530005643535929";
const WABA_ID = process.env.META_WABA_ID || "554629607724135";
const INTERVALO_MS = Number(process.env.VERIFY_RETRY_MS || 10 * 60 * 1000);
const MAX_INTENTOS = Number(process.env.VERIFY_MAX_ATTEMPTS || 30);

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

async function graph(p, { method = "GET", params = {} } = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set(
    "access_token",
    process.env.META_WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN
  );
  const res = await fetch(url, { method });
  return res.json().catch(() => ({}));
}

async function estado() {
  const d = await graph(PHONE_NUMBER_ID, {
    params: {
      fields:
        "display_phone_number,verified_name,status,code_verification_status,quality_rating",
    },
  });
  return d;
}

async function pedirCodigo() {
  return graph(`${PHONE_NUMBER_ID}/request_code`, {
    method: "POST",
    params: { code_method: "SMS", language: "es" },
  });
}

async function main() {
  loadEnv();
  const once = process.argv.includes("--once");

  console.log(
    `\n\x1b[1mVerificacion del numero ${PHONE_NUMBER_ID} (WABA ${WABA_ID})\x1b[0m`
  );

  let actual = await estado();
  console.log("  estado actual:", JSON.stringify(actual));

  if (actual?.code_verification_status === "VERIFIED") {
    console.log("  \x1b[32mEl numero ya esta verificado.\x1b[0m");
    return;
  }

  for (let intento = 1; intento <= (once ? 1 : MAX_INTENTOS); intento++) {
    const r = await pedirCodigo();
    const ok = r && r.success === true;
    const err = r?.error?.error_user_msg || r?.error?.message || "";

    console.log(
      `  [intento ${intento}] ${ok ? "\x1b[32mCODIGO ENVIADO\x1b[0m" : "\x1b[33m" + String(err).slice(0, 90) + "\x1b[0m"}`
    );

    if (ok) {
      console.log(
        "\n  \x1b[1mRevisa el SMS del numero.\x1b[0m Cuando lo tengas:\n" +
          `    node scripts/setup_whatsapp.js ${WABA_ID} ${PHONE_NUMBER_ID} --verify-code <CODIGO>\n`
      );
      return;
    }

    if (once) return;

    const espera = INTERVALO_MS;
    console.log(`  esperando ${Math.round(espera / 60000)} min para reintentar...`);
    await new Promise((r) => setTimeout(r, espera));
  }

  console.log("  \x1b[33mSe agotaron los intentos.\x1b[0m");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
