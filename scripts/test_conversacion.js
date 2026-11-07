#!/usr/bin/env node
/**
 * Prueba del flujo conversacional completo (el caso que planteaste):
 *
 *   1) "hola"                        -> el bot pide el numero de pedido
 *   2) "que paso con mi pedido?"     -> el bot pide el numero de pedido
 *   3) "MON3007"                     -> el bot encuentra el pedido y responde
 *   4) "y cuando me llega?"          -> recuerda el pedido de antes y responde
 *
 * Usa el handler REAL (index.js) y una IA real, pero NO envia nada a
 * Instagram: el remitente es falso.
 *
 *   node scripts/test_conversacion.js
 */

const { handleInstagramMessage } = require("../index.js");

const IGSID = "IGSID_TEST_CONVERSACION_001";

/** Captura lo que el bot "envia". */
function fakeSender() {
  const out = [];
  const sender = async (to, body) => {
    out.push({ to, body });
    return { ok: true, status: 200 };
  };
  sender.out = out;
  return sender;
}

async function turno(texto, sender) {
  await handleInstagramMessage(
    { text: texto, customerId: IGSID, igUserId: "17841408417156397" },
    sender
  );
  const ultimo = sender.out[sender.out.length - 1];
  return ultimo ? ultimo.body : "(sin respuesta)";
}

function mostrar(n, texto) {
  console.log(`\n  \x1b[1mCliente:\x1b[0m ${texto}`);
  console.log(`  \x1b[1mBot:   \x1b[0m ${texto.length > 0 ? "" : ""}${texto}`);
}

(async () => {
  const sender = fakeSender();

  console.log("\n\x1b[1mFlujo conversacional de Instagram\x1b[0m");

  const casos = [
    "hola",
    "que paso con mi pedido?",
    "MON3007",
    "y cuando me llega?",
  ];

  for (const texto of casos) {
    const antes = sender.out.length;
    const t0 = Date.now();
    await turno(texto, sender);
    const dt = Date.now() - t0;
    const enviado = sender.out[antes];

    console.log(`\n  \x1b[36m> \x1b[0m${texto}`);
    console.log(`  \x1b[32m< \x1b[0m${enviado ? enviado.body : "(NO RESPONDIÓ)"}`);
    console.log(`  \x1b[2m(${dt}ms)\x1b[0m`);
  }

  console.log(
    `\n\x1b[1mTotal de respuestas: ${sender.out.length}\x1b[0m` +
      `   destino: ${sender.out.map((m) => m.to).join(", ")}\n`
  );
})().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
