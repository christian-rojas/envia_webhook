#!/usr/bin/env node
/**
 * Escanea pedidos de Shopify buscando las notas de fabricacion.
 *
 * Sirve para responder una pregunta clave: ¿donde estan realmente las notas
 * con el proceso de manufactura (corte, planchado, ensamblaje)?
 *
 *   node scripts/buscar_notas_manufactura.js [MON3007] [limite]
 *
 * Con argumentos, mira un pedido concreto. Sin ellos, escanea los ultimos
 * pedidos y muestra cuales tienen notas de fabricacion.
 */

const shopify = require("../shopify.js");

const KEYWORDS = (
  process.env.MANUFACTURING_KEYWORDS ||
  "corte,elabora,planch,ensamblaj,costur,confecci,producc,tejid,serigraf,estampad,termin,listo,armado,montaje,acabado"
)
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

function tieneManufactura(texto) {
  if (!texto) return false;
  const lower = texto.toLowerCase();
  return KEYWORDS.filter((k) => lower.includes(k));
}

async function main() {
  const pedidoArg = process.argv[2];
  const limite = Number(process.argv[3] || 50);

  console.log("\n\x1b[1mScopes grantados\x1b[0m");
  const scopes = await shopify.getGrantedScopes();
  console.log(
    "  " +
      (scopes.length
        ? scopes.map((s) => s.handle).join(", ")
        : "(ninguno legible)")
  );
  if (!scopes.some((s) => s.handle === "read_all_orders")) {
    console.log(
      "  \x1b[33m! Falta read_all_orders: solo se ven los ultimos 60 dias.\x1b[0m"
    );
  }

  // --- Caso 1: un pedido concreto ---
  if (pedidoArg) {
    console.log(`\n\x1b[1mPedido ${pedidoArg}\x1b[0m`);
    const ctx = await shopify.getOrderContext(pedidoArg);
    if (!ctx.found) {
      console.log("  \x1b[31mNo encontrado.\x1b[0m (puede estar fuera de la ventana)");
      console.log("  Con read_all_orders volveria a aparecer.");
      return;
    }
    console.log(`  creado: ${ctx.createdAt}`);
    console.log(`  items:  ${JSON.stringify(ctx.lineItems)}`);
    console.log(`\n  --- TODAS las notas encontradas ---`);
    console.log(`  note:            ${JSON.stringify(ctx.note)}`);
    console.log(`  note_attributes: ${ctx.properties.length ? ctx.properties : "(vacio)"}`);
    console.log(`  props de items:  ${ctx.properties.length}`);
    console.log(`  metafields:      ${JSON.stringify(ctx.metafields)}`);
    console.log(`  timeline:        ${JSON.stringify(ctx.comments)}`);
    console.log(`\n  --- notas unidas ---`);
    console.log(ctx.notes || "  (ninguna)");
    const kws = tieneManufactura(ctx.notes);
    console.log(
      `\n Fabricacion: ${kws.length ? "SI -> " + kws.join(", ") : "NO detectada"}`
    );
    return;
  }

  // --- Caso 2: escaneo ---
  console.log(`\n\x1b[1mEscaneando los ultimos ${limite} pedidos\x1b[0m`);
  const data = await shopify.shopifyFetch("/orders.json", {
    params: { limit: limite, fields: "name,created_at,note,note_attributes" },
  });
  const orders = data.orders || [];
  console.log(`  pedidos leidos: ${orders.length}\n`);

  let conNotas = 0;
  let conManufactura = 0;

  for (const order of orders) {
    const ctx = await shopify.getOrderContext(order.name);
    if (!ctx.found) continue;

    const attrs = (order.note_attributes || [])
      .map((a) => `${a.name}: ${a.value}`)
      .join("; ");
    const texto = [ctx.note, attrs, ctx.properties.join("; "), ctx.comments.join("; ")]
      .filter(Boolean)
      .join("\n");
    if (!texto) continue;

    conNotas++;
    const kws = tieneManufactura(texto);
    const marca = kws.length ? "\x1b[32m[FABRICACION]\x1b[0m" : "             ";
    if (kws.length) conManufactura++;

    console.log(`${marca} ${order.name} (${(order.created_at || "").slice(0, 10)})`);
    console.log(`    ${texto.replace(/\n/g, "\n    ").slice(0, 500)}`);
    if (kws.length) console.log(`    \x1b[2mpalabras: ${kws.join(", ")}\x1b[0m`);
  }

  console.log(
    `\n\x1b[1mResultado: ${conManufactura} de ${conNotas} pedidos con notas ` +
      `tienen texto de fabricacion\x1b[0m\n`
  );
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
