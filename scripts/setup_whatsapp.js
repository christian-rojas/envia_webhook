#!/usr/bin/env node
/**
 * Configura el webhook de WhatsApp Cloud API para una tienda.
 *
 *   node scripts/setup_whatsapp.js <waba_id> <phone_number_id>
 *
 * Requiere en .env:
 *   META_ACCESS_TOKEN   token con whatsapp_business_messaging y
 *                       whatsapp_business_management
 *   META_APP_SECRET     (para la firma del webhook)
 *   META_VERIFY_TOKEN   token de verificacion del webhook
 *
 * Que hace:
 *   1. Verifica los scopes de WhatsApp del token.
 *   2. Muestra los numeros de telefono del WABA y su estado.
 *   3. Suscribe la app a los eventos del WABA.
 *   4. Verifica la suscripcion.
 */

const fs = require("fs");
const path = require("path");

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v27.0";
const WEBHOOK_URL =
  process.env.META_WEBHOOK_URL || "https://envia-webhook.vercel.app/webhook/meta";
const SUBSCRIBED_FIELDS = ["messages"];

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

async function graph(p, { method = "GET", params = {}, token } = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token || process.env.META_ACCESS_TOKEN);
  const res = await fetch(url, { method });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const ok = (m) => `   \x1b[32mOK\x1b[0m  ${m}`;
const bad = (m) => `   \x1b[31mFALLA\x1b[0m ${m}`;
const warn = (m) => `   \x1b[33m? \x1b[0m  ${m}`;

async function main() {
  loadEnv();

  const token = process.env.META_ACCESS_TOKEN;
  const wabaId = process.argv[2] || process.env.META_WABA_ID;
  const phoneNumberId =
    process.argv[3] || process.env.META_PHONE_NUMBER_ID;

  if (!token) {
    console.error("Falta META_ACCESS_TOKEN (en .env o como variable de entorno).");
    process.exit(1);
  }

  console.log("\n\x1b[1mSetup de WhatsApp Cloud API\x1b[0m");

  // 0) Listar las cuentas de WhatsApp del negocio (necesita business_management)
  if (process.argv.includes("--list-wabas")) {
    const businessId = process.env.SHOPIFY_BUSINESS_ID || "111337664819723";
    console.log(`\n0) Cuentas de WhatsApp del negocio ${businessId}...`);
    const wabas = await graph(`${businessId}/owned_whatsapp_business_accounts`, {
      params: {
        fields: "id,name,account_review_status,phone_numbers{id,display_phone_number,verified_name,code_verification_status,status,quality_rating}",
      },
    });
    if (wabas.body?.error) {
      console.log(bad(wabas.body.error.message));
      console.log(
        "   (falta el scope business_management en el token)"
      );
    } else {
      for (const w of wabas.body?.data || []) {
        console.log(`   ${w.name}  id=${w.id}  (${w.account_review_status || "-"})`);
        for (const p of w.phone_numbers || []) {
          console.log(
            `      ${p.display_phone_number}  id=${p.id}  ${p.verified_name || "(sin nombre)"}` +
              `  ${p.status}  ${p.code_verification_status}  calidad=${p.quality_rating || "-"}`
          );
        }
      }
    }
    return;
  }

  // 1) Scopes
  console.log("\n1) Scopes del token...");
  const perms = await graph("me/permissions");
  const granted = (perms.body?.data || []).map((p) => p.permission);
  for (const scope of [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
  ]) {
    console.log(
      granted.includes(scope) ? ok(scope) : bad(`${scope}  <- falta este scope`)
    );
  }
  console.log(`   scopes: ${granted.join(", ") || "(ninguno)"}`);

  if (!wabaId) {
    console.log(
      "\n2) WABA: no indicado. Pasalo como argumento:\n" +
        "     node scripts/setup_whatsapp.js <waba_id> <phone_number_id>\n" +
        "   El WABA ID y el Phone Number ID estan en\n" +
        "   WhatsApp Manager > Configuracion > API de WhatsApp."
    );
    return;
  }

  // 2) Telefonos del WABA
  console.log(`\n2) Telefonos del WABA ${wabaId}...`);
  const phones = await graph(`${wabaId}/phone_numbers`, {
    params: {
      fields: "id,display_phone_number,verified_name,quality_rating,status,code_verification_status,is_pin_enabled",
    },
  });
  if (phones.body?.error) {
    console.log(bad(phones.body.error.message));
  } else {
    for (const p of phones.body?.data || []) {
      console.log(
        `   ${p.display_phone_number}  id=${p.id}  nombre=${p.verified_name || "(sin verificar)"}  ` +
          `estado=${p.status}  calidad=${p.quality_rating || "-"}  pin=${p.is_pin_enabled}`
      );
    }
  }

  // 3) Suscribir la app a los eventos del WABA
  console.log("\n3) Suscribiendo la app a los webhooks del WABA...");

  // Atajos para la verificacion del numero por codigo.
  const argv = process.argv;
  const requestCode = argv.includes("--request-code");
  const verifyIdx = argv.indexOf("--verify-code");
  const verifyCode = verifyIdx !== -1 ? argv[verifyIdx + 1] : null;

  if (requestCode || verifyCode) {
    const target = phoneNumberId;
    if (!target) {
      console.log(bad("falta el phone_number_id para el flujo de verificacion"));
      return;
    }
    if (requestCode) {
      const res = await graph(`${target}/request_code`, {
        method: "POST",
        params: { code_method: "SMS", language: "es" },
      });
      console.log(
        res.body?.success
          ? ok("codigo solicitado: Meta envio un SMS al numero")
          : bad(res.body?.error?.message || JSON.stringify(res.body))
      );
      return;
    }
    const res = await graph(`${target}/verify_code`, {
      method: "POST",
      params: { code: verifyCode },
    });
    console.log(
      res.body?.success
        ? ok("numero verificado")
        : bad(res.body?.error?.message || JSON.stringify(res.body))
    );
    return;
  }

  const sub = await graph(`${wabaId}/subscribed_apps`, {
    method: "POST",
    params: { subscribed_fields: SUBSCRIBED_FIELDS.join(",") },
  });
  if (sub.body?.success) {
    console.log(ok(`suscrito a: ${SUBSCRIBED_FIELDS.join(", ")}`));
  } else {
    console.log(bad(sub.body?.error?.message || JSON.stringify(sub.body)));
  }

  // 4) Estado final
  console.log("\n4) Estado final...");
  const check = await graph(`${wabaId}/subscribed_apps`, {
    params: { fields: "subscribed_fields" },
  });
  const fields = check.body?.data?.[0]?.subscribed_fields;
  console.log(
    fields?.length
      ? ok(`campos suscritos: ${fields.join(", ")}`)
      : bad(`sin campos suscritos ${JSON.stringify(check.body)}`)
  );

  console.log(`\n   Webhook URL: ${WEBHOOK_URL}`);
  console.log(
    `   Verify token: el mismo que META_VERIFY_TOKEN en el servidor.\n` +
      `   Si Meta no lo configuro desde el panel, se puede forzar con:\n` +
      `   POST /${wabaId}/subscribed_apps?override_callback_uri=${encodeURIComponent(WEBHOOK_URL)}` +
      `&verify_token=<token>`
  );
  // 5) Verificacion del numero (si no esta verificado)
  console.log("\n5) Verificacion del numero...");
  const phones2 = await graph(`${wabaId}/phone_numbers`, {
    params: { fields: "id,display_phone_number,code_verification_status,status" },
  });
  const pendiente = (phones2.body?.data || []).find(
    (p) => p.code_verification_status !== "VERIFIED"
  );

  if (!pendiente) {
    console.log(ok("todos los numeros estan verificados"));
  } else {
    console.log(
      warn(
        `${pendiente.display_phone_number} (${pendiente.id}) sin verificar ` +
          `(${pendiente.code_verification_status}, ${pendiente.status})`
      )
    );
    console.log(
      "   Para pedir el codigo por SMS:\n" +
        `     node scripts/setup_whatsapp.js ${wabaId} ${pendiente.id} --request-code\n` +
        "   Meta manda un SMS al numero; despues:\n" +
        `     node scripts/setup_whatsapp.js ${wabaId} ${pendiente.id} --verify-code <CODIGO>`
    );
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
