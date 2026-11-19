/**
 * Enriquece los 38 titulos de producto que tenian menos de 25 caracteres.
 *
 * Por que: en Google Shopping el titulo es el mayor factor de CTR, y el feed
 * los mandaba tal cual ("Poleron - ICON", "Parka - ALLIANZ"). Con 96 de 100
 * productos sin opcion de color (el color va en el titulo), el titulo es el
 * unico sitio donde cabe la palabra clave.
 *
 * Regla: se respeta el formato de la casa ("Tipo - [Unisex] - NOMBRE COLOR")
 * y se anade el material o la caracteristica que la descripcion del producto
 * ya dice (impermeable, termica, de franela, de chiporro...). No se inventa
 * nada: todo sale de la descripcion.
 *
 * NO se cambia el handle, asi que no hay redirecciones ni se pierde autoridad.
 * El SKU tampoco se toca.
 */
require("dotenv").config();
const fs = require("fs");
const SHOP = process.env.SHOPIFY_SHOP;

// handle -> titulo nuevo
const TITULOS = {  // backup de los titulos anteriores: /tmp/backup_titulos_2026-11-19.json
  "parka-lenadora-flags": "Parka - Impermeable Leñadora Flags",
  "poleron-belair": "Polerón - Unisex - Belair de Franela",
  "parka-allianz": "Parka - Impermeable Leñadora ALLIANZ",
  "poleron-icon": "Polerón - Unisex - ICON",
  "poleron-hoodie-morado": "Polerón - Unisex - Hoodie Morado",
  "poleron-hoodie-yellow": "Polerón - Unisex - Hoodie Yellow",
  "casaca-capucha-poleron": "Casaca - Impermeable con Capucha de Polerón",
  "conjunto-multicolor-1": "Conjunto - Unisex - NEW COLORFUL",
  "cortaviento-ashes": "Cortaviento - Repelente al Agua ASHES",
  "poleron-1": "Polerón - Unisex - BLAZE de Franela",
  "chiporro-brown": "Abrigo de Chiporro con Forro Fleece CREAM",
  "vestido-animal-print": "Vestido de Punto Estampado Animal Print",
  "parka-winter-mountain": "Parka - Térmica Impermeable Winter Mountain",
  "conjunto-cargo-wind": "Conjunto - Unisex - Cargo Wind",
  "conjunto-crop-top": "Conjunto - Unisex - Crop Top con Pantalón Wide Leg",
  "poleron-urban": "Polerón - Unisex - Urban",
  "cortaviento-vintage-1": "Cortaviento - Impermeable Vintage",
  "poleron-nostalgic": "Polerón - Unisex - Nostalgic",
  "poleron-canguro-azul": "Polerón - Unisex - Canguro Azul",
  "poleron-blue-colors": "Polerón - Unisex - Blue Colors",
  "vestido-punto-coquette": "Vestido de Punto Elástico Coquette",
  "wind-jacket": "Casaca - Impermeable Wind Jacket",
  "polera-you-are-lucky": "Polera Boxy Fit You Are Lucky",
  "denim-jacket": "Chaqueta de Denim Azul con Serigrafía",
  "vestido-olas-nomadas": "Vestido Largo Halter Olas Nómadas",
  "camisa-boho-arena-mao": "Camisa Boho de Algodón Arena Cuello Mao",
  "fucsia-bold": "Conjunto de Polerón y Pantalón Fucsia Bold",
  "pantalon-flow-maestro": "Pantalón Ancho de Tela Texturizada Flow Maestro",
  "vestido-eolo": "Vestido Largo Wrap Vintage Eolo",
  "conjunto-copacabana": "Conjunto Guinda de Lentejuelas Copacabana",
  "conjunto-ipanema": "Conjunto Top Halter y Falda Pareo Ipanema",
  "vestido-brisa-carioca": "Vestido Largo Halter Translúcido Brisa Carioca",
  "vestido-samba-rose": "Vestido Mini Strapless de Lentejuelas Samba Rosé",
  "chaqueta-la-black-fur": "Chaqueta Impermeable con Forro Thermaheat Black Fur",
  "abrigo-tedd-a-cuadros": "Abrigo de Bouclé Estampado a Cuadros",
  "poleron-duffle-cropped": "Polerón Cropped de Franela Beige Duffle",
  "abrigo-camel-leather": "Abrigo de Ecocuero Camel Leather",
  "falda-camel-leather": "Falda de Ecocuero Camel Leather",
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

  // 1) productos
  const j = await gql(`{ products(first: 120, query: "status:active") { nodes { id handle title } } }`);
  const porHandle = new Map(j.data.products.nodes.map((p) => [p.handle, p]));

  // 2) backup de los titulos actuales
  const backup = {};
  for (const [handle, nuevo] of Object.entries(TITULOS)) {
    const p = porHandle.get(handle);
    if (p) backup[handle] = { id: p.id, tituloViejo: p.title, tituloNuevo: nuevo };
  }
  fs.writeFileSync("/tmp/backup_titulos_2026-11-19.json", JSON.stringify(backup, null, 1));
  console.log(`  backup de ${Object.keys(backup).length} titulos -> /tmp/backup_titulos_2026-11-19.json`);

  // 3) aplicar
  let ok = 0;
  let fallos = [];
  for (const [handle, nuevo] of Object.entries(TITULOS)) {
    const p = porHandle.get(handle);
    if (!p) { fallos.push(handle + ": no encontrado"); continue; }
    const r = await gql(
      `mutation { productUpdate(input: {id: "${p.id}", title: ${JSON.stringify(nuevo)}}) { product { id title handle } userErrors { message field } } }`
    );
    const ue = r.data && r.data.productUpdate ? r.data.productUpdate.userErrors : r.errors;
    if (ue && ue.length) fallos.push(`${handle}: ${JSON.stringify(ue).slice(0, 90)}`);
    else { ok++; console.log(`  ${p.title}  ->  ${nuevo}`); }
  }
  console.log(`\n  actualizados: ${ok}/${Object.keys(TITULOS).length}`);
  if (fallos.length) console.log("  FALLOS: " + fallos.join(" | "));
})();
