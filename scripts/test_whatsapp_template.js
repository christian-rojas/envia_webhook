/**
 * Prueba del envio por plantilla (Cloud API) y del timeout con node-fetch v2.
 */
const path = "/Users/christianrojas/Desktop/projects/envia_webhook";
require(`${path}/node_modules/dotenv`).config();
const meta = require(`${path}/meta.js`);

(async () => {
  console.log("=== 1) timeout con node-fetch v2 (AbortSignal.timeout) ===");
  const t0 = Date.now();
  const r = await meta.sendTemplateMessage(
    "56911111111",
    "mondano_hxd04183bb87ff888c98d7131b5ba50dde",
    ["Claudio", "MON4720"]
  );
  console.log(`   ok=${r.ok} status=${r.status} en ${Date.now() - t0} ms`);
  console.log(`   error: ${String(r.error).slice(0, 260)}`);

  console.log("\n=== 2) sin parametros (plantilla sin placeholders) ===");
  const r2 = await meta.sendTemplateMessage("56911111111", "pedido_esperando_a_ser_enviado", []);
  console.log(`   ok=${r2.ok} status=${r2.status}`);
  console.log(`   error: ${String(r2.error).slice(0, 220)}`);

  console.log("\n=== 3) numero de telefono no configurado ===");
  const guardado = process.env.META_PHONE_NUMBER_ID;
  process.env.META_PHONE_NUMBER_ID = "PENDIENTE";
  const r3 = await meta.sendTemplateMessage("56911111111", "x", ["a"]);
  process.env.META_PHONE_NUMBER_ID = guardado;
  console.log(`   ok=${r3.ok} error=${r3.error}`);
})();
