/**
 * Pruebas de alcance y contenido del bot.
 *   1) si no pregunta por un pedido -> no contesta
 *   2) si dice que ya llego -> no pide el numero de pedido
 *   3) si la IA falla -> no manda mensaje de error
 */
const path = "/Users/christianrojas/Desktop/projects/envia_webhook";
require(`${path}/node_modules/dotenv`).config();

const ai = require(`${path}/ai.js`);
const index = require(`${path}/index.js`);

let fallos = 0;
function check(nombre, ok, extra = "") {
  console.log(`  ${ok ? "OK " : "FAIL"}  ${nombre}${extra ? "  " + extra : ""}`);
  if (!ok) fallos++;
}

console.log("=== 1) ALCANCE: mensajes que NO deben activar al bot ===\n");
const NO_DEBE = [
  "Hola",
  "Hola!",
  "Buenas tardes",
  "ok",
  "gracias!!",
  "jajaja",
  "Que buena foto",
  "Bueno",
  "👍",
  "Me encanta esa prenda",
  "Que precio tienen las poleras?",
  "Tienen tienda fisica?",
  "Que marca hacen?",
];
const SI_DEBE = [
  "MON4676",
  "mi pedido MON4676",
  "cuando llega mi pedido",
  "cuando me llega el pedido",
  "donde esta mi paquete",
  "cual es el estado de mi envio",
  "necesito el numero de seguimiento",
  "que paso con mi pedido",
  "no me ha llegado",
  "aun no me llega",
  "mi compra sigue en camino?",
  "en cuanto llega",
  "cuanto demora en llegar",
  "ya me llego",
  "ya recibi el pedido",
];

console.log("  -- que NO deben activar el bot --");
for (const t of NO_DEBE) {
  const activa = ai.isTrackingIntent(t) || /MON\d/.test(t);
  check(`"${t}"`, !activa, activa ? "<-- se activaria (mal)" : "");
}

console.log("\n  -- que SI deben activar el bot --");
for (const t of SI_DEBE) {
  const activa = ai.isTrackingIntent(t) || /MON\d/.test(t);
  check(`"${t}"`, activa, activa ? "" : "<-- NO se activaria (mal)");
}

console.log("\n=== 2) 'YA LLEGO': deteccion ===\n");
const YA_LLEGO = [
  "ya llego",
  "ya me llego",
  "ya lo tengo",
  "me llego bien",
  "lo recibi",
  "recibi el pedido",
  "ya recibi mi pedido",
  "recien llego",
  "me lo trajeron",
  "ya esta en mi casa",
  "el pedido ya llego",
];
const NO_YA_LLEGO = [
  "cuando ya llegue me avisas",
  "aun no me llega",
  "todavia no llego",
  "no me ha llegado",
  "no he recibido nada",
  "cuando llega mi pedido",
  "si ya llega avisame",
  "falta mi pedido",
];
console.log("  -- SI llego (debe detectarse) --");
for (const t of YA_LLEGO) {
  check(`"${t}"`, ai.saysAlreadyArrived(t), ai.saysAlreadyArrived(t) ? "" : "<-- no se detecto");
}
console.log("\n  -- NO llego todavia (no debe detectarse) --");
for (const t of NO_YA_LLEGO) {
  check(`"${t}"`, !ai.saysAlreadyArrived(t), ai.saysAlreadyArrived(t) ? "<-- falso positivo" : "");
}

console.log("\n=== 3) Contexto de 'ya llego': NO pide el numero de pedido ===\n");
const ctx = ai.buildAlreadyArrivedContext({ orderId: "MON4676" });
check("el contexto no pide el numero de pedido", !/Pide el numero de pedido/i.test(ctx));
check("el contexto menciona que ya llego", /YA LLEGO/i.test(ctx));
const ctxMissing = ai.buildMissingDataContext({ reason: "sin_datos" });
check("(control) el contexto de datos faltantes SI pide el numero", /Pide el numero de pedido/i.test(ctxMissing));

console.log("\n=== 4) Comportamiento de los handlers ===\n");

(async () => {
  // --- Instagram: mensaje fuera de alcance -> no contesta ---
  const enviadosIG = [];
  const senderIG = async (to, body) => { enviadosIG.push(body); return { ok: true }; };
  await index.handleInstagramMessage({ text: "Que buena foto", customerId: "123" }, senderIG);
  check("instagram no responde a 'Que buena foto'", enviadosIG.length === 0, enviadosIG.length ? `envio: ${enviadosIG[0]}` : "");

  // --- Instagram: mensaje valido -> contesta ---
  const enviadosIG2 = [];
  const senderIG2 = async (to, body) => { enviadosIG2.push(body); return { ok: true }; };
  await index.handleInstagramMessage({ text: "MON4676", customerId: "123" }, senderIG2);
  check("instagram responde a 'MON4676'", enviadosIG2.length === 1, `-> ${String(enviadosIG2[0]).slice(0, 70)}`);

  // --- Instagram: 'ya llego' -> no pide el numero de pedido ---
  const enviadosIG3 = [];
  const senderIG3 = async (to, body) => { enviadosIG3.push(body); return { ok: true }; };
  await index.handleInstagramMessage({ text: "ya me llego el pedido", customerId: "999" }, senderIG3);
  const pidioNumero = enviadosIG3.some((t) => /numero de pedido|MON\d{4}/i.test(t));
  check("instagram NO pide numero de pedido si ya llego", !pidioNumero, `-> ${String(enviadosIG3[0]).slice(0, 110)}`);
  check("instagram responde algo a 'ya me llego'", enviadosIG3.length === 1);

  // --- WhatsApp: mensaje fuera de alcance -> no contesta ---
  const enviadosWA = [];
  const senderWA = async (to, body) => { enviadosWA.push(body); return { ok: true }; };
  await index.handleInboundMessage({ from: "56999999999", text: "Hola" }, senderWA);
  check("whatsapp no responde a 'Hola'", enviadosWA.length === 0, enviadosWA.length ? `envio: ${enviadosWA[0]}` : "");

  // --- WhatsApp: mensaje valido -> contesta ---
  const enviadosWA2 = [];
  const senderWA2 = async (to, body) => { enviadosWA2.push(body); return { ok: true }; };
  await index.handleInboundMessage({ from: "56988888888", text: "cuando llega mi pedido MON4706" }, senderWA2);
  check("whatsapp responde a 'cuando llega mi pedido'", enviadosWA2.length === 1, `-> ${String(enviadosWA2[0]).slice(0, 70)}`);

  // --- WhatsApp: 'ya llego' -> no pide el numero de pedido ---
  const enviadosWA3 = [];
  const senderWA3 = async (to, body) => { enviadosWA3.push(body); return { ok: true }; };
  await index.handleInboundMessage({ from: "56977777777", text: "ya llego el pedido" }, senderWA3);
  const pidioNumeroWA = enviadosWA3.some((t) => /numero de pedido|MON\d{4}/i.test(t));
  check("whatsapp NO pide numero de pedido si ya llego", !pidioNumeroWA, `-> ${String(enviadosWA3[0]).slice(0, 110)}`);

  // --- Si la IA falla, NO se manda mensaje de error al cliente ---
  const aiReal = ai.generateReply;
  ai.generateReply = async () => ({ ok: false, reply: "", error: "simulado" });
  const enviadosErr = [];
  const senderErr = async (to, body) => { enviadosErr.push(body); return { ok: true }; };
  await index.handleInstagramMessage({ text: "MON4676", customerId: "555" }, senderErr);
  check("instagram NO manda mensaje de error si falla la IA", enviadosErr.length === 0, enviadosErr.length ? `envio: ${enviadosErr[0]}` : "");
  const enviadosErrWA = [];
  const senderErrWA = async (to, body) => { enviadosErrWA.push(body); return { ok: true }; };
  await index.handleInboundMessage({ from: "56966666666", text: "cuando llega MON4706" }, senderErrWA);
  check("whatsapp NO manda mensaje de error si falla la IA", enviadosErrWA.length === 0, enviadosErrWA.length ? `envio: ${enviadosErrWA[0]}` : "");
  ai.generateReply = aiReal;

  console.log(`\n=== RESULTADO: ${fallos === 0 ? "TODO OK" : fallos + " FALLOS"} ===`);
  process.exit(fallos === 0 ? 0 : 1);
})();
