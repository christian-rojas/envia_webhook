/**
 * Reescribe las 9 descripciones de producto debiles (vacias o de menos de
 * 200 caracteres).
 *
 * Que por que: la descripcion es lo que el feed de Google Shopping manda y
 * lo que Google indexa. Con 9 de 105 productos vacias, el motor se queda
 * sin texto que leer.
 *
 * Regla: no se inventa ninguna caracteristica. Todo lo que se dice sale de la
 * descripcion original del producto (tela, forro, cierre, cuidados, unisex) o
 * es un enlace interno (colecciones, guia de tallas). Se conservan los datos
 * tecnicos (composicion, medidas, epoca) y se les anade contexto util.
 */
require("dotenv").config();
const fs = require("fs");
const SHOP = process.env.SHOPIFY_SHOP;

const DESCRIPCIONES = {
  "parka-lenadora-flags": `<p>Parka tipo leñadora para la temporada otoño-invierno. <strong>Unisex</strong>.</p>
<p>Material exterior: Taslan Rip, 100% impermeable. Forro de chiporro (el color del forro es referencial). Cierre completo y con broches.</p>
<p>Para el frío y la lluvia, mírala junto a nuestras <a href="/collections/parkas-y-casacas">parkas y casacas</a> y nuestros <a href="/collections/cortavientos">cortavientos</a>. Para elegir tu talla, mide una prenda que te quede bien y compárala con nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,

  "vestido-tirantes-full-colors": `<p>Maxi vestido de tirantes, con cuello alto y amarras ajustables para acomodar el escote a tu medida.</p>
<p>El modelo de las fotos mide una talla S. Mide una prenda que te quede bien y compárala con nuestra <a href="/pages/guia-de-tallas">guía de tallas</a> para saber cuál te corresponde.</p>
<p>Para una ocasión especial, mira también nuestros <a href="/collections/vestidos">vestidos</a>.</p>`,

  "black-baggy-jeans": `<p>Jeans negros de corte baggy, <strong>unisex</strong>. Con cierres laterales que se pueden abrir y cerrar, y un interior tipo militar que le suma un toque único.</p>
<p>Talla única standard, de la 40 a la 44.</p>
<p>Combínalos con un <a href="/collections/polerones">polerón oversize</a> o una <a href="/collections/camisas">camisa</a>, y revisa nuestra <a href="/pages/guia-de-tallas">guía de tallas</a> para elegir bien.</p>`,

  "straight-jeans": `<p>Jeans azul de corte recto con estampado de serigrafía: el complemento perfecto para un outfit minimalista y elegante. <strong>Unisex</strong>.</p>
<p>Talla única, sirve de la 40 a la 44.</p>
<p>Combínalos con un <a href="/collections/polerones">polerón</a> o una <a href="/collections/camisas">camisa</a>. Las medidas están en nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,

  "denim-jacket": `<p>Chaqueta de jeans azul con serigrafía y textos minimalistas de la colección: una prenda que busca la elegancia y lo urbano a la vez. <strong>Unisex</strong>.</p>
<p>Combínala con un <a href="/collections/pantalones">pantalón</a> o un <a href="/collections/polerones">polerón oversize</a>, y mira nuestra <a href="/pages/guia-de-tallas">guía de tallas</a> para las tallas.</p>`,

  "abrigo-tedd-a-cuadros": `<p>Abrigo en tela fantasía de poliéster (100% poliéster), con textura bouclé y estampado a cuadros.</p>
<p>Para el frío, míralo junto a nuestras <a href="/collections/parkas-y-casacas">parkas y casacas</a> y nuestros <a href="/collections/cortavientos">cortavientos</a>. Las tallas están en nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,

  "abrigo-zebra-teddy-coat": `<p>Abrigo tipo teddy coat con estampado zebra, en 100% poliéster.</p>
<p>Un abrigo con carácter, para combinar con lo que sea. Para el frío, míralo junto a nuestras <a href="/collections/parkas-y-casacas">parkas y casacas</a> y nuestros <a href="/collections/cortavientos">cortavientos</a>. Las tallas están en nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,

  "abrigo-camel-leather": `<p>Abrigo en ecocuero (50% poliéster y 50% PU), del mismo camel que nuestra <a href="/products/falda-camel-leather">falda</a>.</p>
<p><strong>Cuidado:</strong> estas prendas no se lavan. Solo se limpian con un paño húmedo o cremas y se ventilan. No las sometas a ningún tipo de lavado.</p>
<p>Combínalo con un <a href="/collections/pantalones">pantalón</a> o una <a href="/collections/vestidos">falda</a>. Para las tallas, mira nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,

  "falda-camel-leather": `<p>Falda en ecocuero (50% poliéster y 50% PU), del mismo camel que nuestro <a href="/products/abrigo-camel-leather">abrigo</a>.</p>
<p><strong>Cuidado:</strong> no se lava. Solo se limpia con un paño húmedo o cremas y se ventila. No la sometas a ningún tipo de lavado.</p>
<p>Combínala con un <a href="/collections/polerones">polerón oversize</a> o una <a href="/collections/camisas">camisa</a>. Las tallas están en nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>`,
};

(async () => {
  const t = await (
    await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    })
  ).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = `https://${SHOP}.myshopify.com/admin/api/2026-01`;
  const gql = async (q) =>
    (await (await fetch(A + "/graphql.json", { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json());

  const j = await gql(`{ products(first: 120, query: "status:active") { nodes { id handle title descriptionHtml } } }`);
  const porHandle = new Map(j.data.products.nodes.map((p) => [p.handle, p]));

  const backup = {};
  for (const [handle, html] of Object.entries(DESCRIPCIONES)) {
    const p = porHandle.get(handle);
    if (!p) { console.log("  ? no existe " + handle); continue; }
    backup[handle] = { id: p.id, titulo: p.title, descripcionVieja: p.descriptionHtml, descripcionNueva: html };
  }
  fs.writeFileSync("/tmp/backup_descripciones_2026-11-19.json", JSON.stringify(backup, null, 1));
  console.log(`  backup de ${Object.keys(backup).length} descripciones -> /tmp/backup_descripciones_2026-11-19.json`);

  let ok = 0;
  for (const [handle, html] of Object.entries(DESCRIPCIONES)) {
    const p = porHandle.get(handle);
    if (!p) continue;
    const r = await gql(
      `mutation { productUpdate(input: {id: "${p.id}", descriptionHtml: ${JSON.stringify(html)}}) { product { id title } userErrors { message field } } }`
    );
    const ue = r.data && r.data.productUpdate ? r.data.productUpdate.userErrors : r.errors;
    if (ue && ue.length) console.log(`  X ${handle}: ${JSON.stringify(ue).slice(0, 120)}`);
    else { ok++; console.log(`  OK ${p.title}`); }
  }
  console.log(`\n  actualizadas: ${ok}/${Object.keys(DESCRIPCIONES).length}`);
})();
