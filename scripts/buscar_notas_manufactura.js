#!/usr/bin/env node
/**
 * Escanea TODO el historial de pedidos de Shopify buscando las notas de
 * fabricacion (corte, planchado, ensamblaje, taller...).
 *
 * Usa GraphQL con paginacion: con `read_all_orders` la conexion `orders`
 * devuelve los ~3700 pedidos del historico, mientras que REST /orders.json
 * solo devuelve 76 y `?name=` no encuentra los antiguos.
 *
 *   node scripts/buscar_notas_manufactura.js            # escanea todo
 *   node scripts/buscar_notas_manufactura.js MON3007    # un pedido
 */

const shopify = require("../shopify.js");

const KEYWORDS = (
  process.env.MANUFACTURING_KEYWORDS ||
  "taller,corte,elabora,planch,ensamblaj,costur,confecci,producc,tejid,serigraf,estampad,termin,listo,armado,montaje,acabado"
)
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

function palabras(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return KEYWORDS.filter((k) => lower.includes(k));
}

async function escanearTodo() {
  let after = null;
  let paginas = 0;
  let total = 0;
  let conNota = 0;
  let conDetalle = 0;
  const hallazgos = [];
  const muestras = new Map();
  const t0 = Date.now();

  while (paginas < 40) {
    const query = `query ($after: String) {
      orders(first: 250, after: $after, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            name
            createdAt
            note
            events(first: 60) {
              edges {
                node {
                  __typename
                  ... on CommentEvent { message }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const data = await shopify.graphql(query, { after });
    const edges = data.orders?.edges || [];
    if (!edges.length) break;

    total += edges.length;
    paginas++;

    for (const edge of edges) {
      const node = edge.node;
      const comments = (node.events?.edges || [])
        .map((e) => e.node)
        .filter((e) => e.__typename === "CommentEvent")
        .map((e) => e.message);

      const texto = [node.note, ...comments].filter(Boolean).join("\n");
      if (!texto) continue;
      conNota++;

      const kws = palabras(texto);
      if (kws.length) {
        conDetalle++;
        hallazgos.push({
          name: node.name,
          at: (node.createdAt || "").slice(0, 10),
          note: node.note,
          comments,
          kws,
        });
      }

      // Muestra de cada nota distinta
      for (const t of [node.note, ...comments]) {
        const t2 = (t || "").trim();
        if (t2 && !muestras.has(t2)) muestras.set(t2, { n: 0, kws: palabras(t2) });
        if (t2) muestras.get(t2).n++;
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  console.log(
    `\n\x1b[1mEscaneo completo: ${total} pedidos en ${paginas} paginas ` +
      `(${(Date.now() - t0) / 1000}s)\x1b[0m`
  );
  console.log(`  pedidos con alguna nota: ${conNota}`);
  console.log(`  notas con detalle de fabricacion: \x1b[1m${conDetalle}\x1b[0m`);

  if (hallazgos.length) {
    console.log("\n\x1b[1mDetalle de fabricacion encontrado:\x1b[0m");
    for (const h of hallazgos) {
      console.log(`  ${h.name} (${h.at})  [${h.kws.join(", ")}]`);
      if (h.note) console.log(`      note: ${JSON.stringify(h.note.slice(0, 300))}`);
      for (const c of h.comments) console.log(`      timeline: ${JSON.stringify(c.slice(0, 300))}`);
    }
  }

  const conPalabras = [...muestras.entries()].filter(([, v]) => v.kws.length);
  console.log(`\n\x1b[1mNotas distintas con palabras de fabricacion: ${conPalabras.length}\x1b[0m`);
  for (const [texto, v] of conPalabras) {
    console.log(`  x${String(v.n).padStart(3)}  ${JSON.stringify(texto.slice(0, 220))}`);
  }

  console.log(`\n\x1b[1mNotas distintas totales: ${muestras.size}\x1b[0m`);
  const top = [...muestras.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20);
  for (const [texto, v] of top) {
    console.log(`  x${String(v.n).padStart(3)}  ${JSON.stringify(texto.slice(0, 160))}`);
  }
  console.log();
}

async function main() {
  const pedido = process.argv[2];

  console.log("\n\x1b[1mScopes concedidos\x1b[0m");
  const scopes = await shopify.getGrantedScopes();
  console.log("  " + (scopes.length ? scopes.map((s) => s.handle).join(", ") : "(ninguno)"));
  if (!scopes.some((s) => s.handle === "read_all_orders")) {
    console.log(
      "  \x1b[33m! Falta read_all_orders: solo se ven los ultimos 60 dias.\x1b[0m"
    );
  }

  if (pedido) {
    console.log(`\n\x1b[1mPedido ${pedido}\x1b[0m`);
    const ctx = await shopify.getOrderContext(pedido);
    if (!ctx.found) {
      console.log("  \x1b[31mNo encontrado.\x1b[0m");
      return;
    }
    console.log(`  creado:    ${ctx.createdAt}`);
    console.log(`  items:     ${ctx.lineItems.map((i) => `${i.title} x${i.quantity}`).join(", ")}`);
    console.log(`  note:      ${JSON.stringify(ctx.note)}`);
    console.log(`  timeline:  ${JSON.stringify(ctx.comments)}`);
    console.log(`  props:     ${JSON.stringify(ctx.properties)}`);
    console.log(`  metafields:${JSON.stringify(ctx.metafields.map((m) => m.key))}`);
    console.log(`\n  --- notas unidas ---\n  ${ctx.notes || "(ninguna)"}`);
    const kws = palabras(ctx.notes);
    console.log(`\n  Fabricacion: ${kws.length ? "SI -> " + kws.join(", ") : "NO detectada"}`);
    return;
  }

  await escanearTodo();
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
