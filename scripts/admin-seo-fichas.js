/**
 * Bloque 3 del plan SEO (22-12-2026): titles y meta descriptions de las
 * fichas de abrigo, que son las que hoy rankean con CTR bajo.
 *
 *   node scripts/admin-seo-fichas.js            -> dry-run
 *   node scripts/admin-seo-fichas.js --aplicar   -> escribe
 *
 * Solo se escribe seo.title y seo.description. NO se toca:
 *   - product.title (el H1 y el nombre que ve el cliente y el bot)
 *   - el handle (las URLs no cambian)
 *   - el contenido, el precio, el SKU ni las variantes
 *
 * Los materiales, el calce y los colores salen de la descripcion real de cada
 * producto y de los metafields custom.gender / custom.color. Nada inventado.
 *
 * Se deja fuera cortaviento-vintage-1: ya rankea (posicion 2,4 con CTR de
 * 7-10%) y su title ya lleva la keyword. No se toca lo que funciona.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const FICHAS = {
  // ---------------------------------------------------------------- parkas
  "parka-jackdaw": {
    title: "Parka Impermeable Térmica Jackdaw | Mondano Chile",
    desc: "Parka Jackdaw en Taslan Pu con forro térmico Thermaheat Lite: impermeable, liviana y ajustable. Para llevar sobre otra prenda. Unisex, XS a XXL.",
  },
  "parka-lenadora-flags": {
    title: "Parka Leñadora Impermeable Flags | Mondano Chile",
    desc: "Parka leñadora en Taslan Rip 100% impermeable, con forro de chiporro, cierre completo y broches. Unisex, XS a XXL. Para el frío y la lluvia. Envío a Chile.",
  },
  "parka-allianz": {
    title: "Parka Leñadora Impermeable ALLIANZ | Mondano Chile",
    desc: "Parka leñadora ALLIANZ en Taslan Rip 100% impermeable, con forro de chiporro. En azul marino y amarillo oro. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "parka-impermeable-rainproof-purple": {
    title: "Parka Impermeable Morada | Mondano Chile",
    desc: "Parka impermeable en Taslan Rip con forro Thermafleece 300 de 2 cm. Térmica, con capucha y antipilling, en negro, fucsia y morado. Unisex, XS a XXL.",
  },
  "parka-impermeable-urban": {
    title: "Parka Impermeable Oversize Marquam Peak | Mondano Chile",
    desc: "Parka Marquam Peak: calce oversize, forro Thermafleece aterciopelado y tela exterior altamente impermeable. Para días fríos y húmedos. Unisex, XS a XXL.",
  },
  "parka-new-jackdaw": {
    title: "Parka Impermeable New Jackdaw | Mondano Chile",
    desc: "Parka New Jackdaw en Taslan Rip con forro térmico Thermafleece 300. Impermeable y liviana: se usa sobre una prenda. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "parka-ruster": {
    title: "Parka Impermeable Térmica Ruster | Mondano Chile",
    desc: "Parka Ruster en Taslan Rip impermeable con forro de corderito de 2 cm. Térmica y con capucha, en turquesa, fucsia y amarillo oro. Unisex, XS a XXL.",
  },
  "parka": {
    title: "Parka Impermeable Térmica Lynn | Mondano Chile",
    desc: "Parka Lynn con tela exterior impermeable, liviana y confortable, y forro térmico. Ideal para el frío y la lluvia. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "parka-acorchada-sin-mangas": {
    title: "Parka Impermeable Acolchada Sin Mangas | Mondano Chile",
    desc: "Parka acolchada sin mangas en tejido ripstop: cuello subido, sin capucha y tela altamente impermeable. Liviana y cómoda. Unisex, XS a XXL. Envío a Chile.",
  },
  "parka-winter-mountain": {
    title: "Parka Impermeable Térmica Winter Mountain | Mondano Chile",
    desc: "Parka Winter Mountain con forro térmico Thermaheat Lite. Liviana e impermeable, al estilo de un gran cortaviento. Para usar sobre otra prenda. Unisex, XS a XXL.",
  },
  "parka-winter-mosaic": {
    title: "Parka Impermeable Térmica Winter Mosaic | Mondano Chile",
    desc: "Parka Winter Mosaic: liviana, repelente al agua y con forro térmico Thermaheat Lite. Se usa sobre otra prenda, al estilo de un gran cortaviento. Unisex.",
  },
  "parka-blizzard": {
    title: "Parka Impermeable Térmica Blizzard | Mondano Chile",
    desc: "Parka Blizzard liviana e impermeable, con forro térmico Thermaheat Lite y tecnología de reflexión infrarroja. Para usar sobre otra prenda. Unisex, XS a XXL.",
  },
  "parka-turquesa-urban-trek": {
    title: "Parka Impermeable Turquesa Urban Trek | Mondano Chile",
    desc: "Parka Urban Trek en turquesa para ella, con capucha, bolsillos y corte clásico. Forro térmico Thermaheat Lite. Para la ciudad o el aire libre. XS a XXL.",
  },

  // ---------------------------------------------------------------- casacas
  "casaca-capucha-poleron": {
    title: "Casaca Impermeable con Capucha de Polerón | Mondano Chile",
    desc: "Casaca con gorro de polerón, exterior Taslan Rip y forro Thermaflecee 300: impermeable, térmica y liviana. Para el frío y la lluvia. Unisex, XS a XXL.",
  },
  "casaca-mondano-collor": {
    title: "Casaca Impermeable con Forro Thermafleece | Mondano Chile",
    desc: "Casaca Collor en Taslan Rip con forro Thermaflecee 300: tela altamente impermeable, térmica y liviana. Para un invierno cálido. Unisex, XS a XXL. Envío a Chile.",
  },
  "casaca-o-parka-iconic-yellow": {
    title: "Casaca o Parka Impermeable ICONIC Yellow | Mondano Chile",
    desc: "Casaca o parka ICONIC en amarillo: exterior a prueba de agua y forro Thermaflecee 300. Ligera y térmica, en versión casaca o parka. Mide tu talla.",
  },
  "casaca-o-parka-iconic-purple": {
    title: "Casaca o Parka Impermeable ICONIC Purple | Mondano Chile",
    desc: "Casaca o parka ICONIC morada: exterior a prueba de agua y forro Thermaflecee 300. Ligera y térmica, en versión casaca o parka. Mide tu talla.",
  },
  "casaca-o-parka-iconic-pink": {
    title: "Casaca o Parka Impermeable ICONIC Pink | Mondano Chile",
    desc: "Casaca o parka ICONIC rosa: exterior a prueba de agua y forro Thermaflecee 300. Ligera y térmica, en versión casaca o parka. Mide tu talla.",
  },
  "casaca-o-parka-iconic-calypso": {
    title: "Casaca o Parka Impermeable ICONIC Calypso | Mondano Chile",
    desc: "Casaca o parka ICONIC en azul: exterior a prueba de agua y forro Thermaflecee 300. Ligera y térmica, en versión casaca o parka. Mide tu talla.",
  },
  "casaca-o-parka-colour-block": {
    title: "Casaca o Parka Impermeable Colour Block | Mondano Chile",
    desc: "Casaca o parka Colour Block en tejido plano repelente al agua y térmica, con forro Thermaflecee 300. Versión casaca o parka. Mide tu talla antes.",
  },
  "wind-jacket": {
    title: "Casaca Impermeable Wind Jacket | Mondano Chile",
    desc: "Casaca Wind Jacket con capucha protectora, protector de barbilla y bolsillos para tus manos. Liviana, repelente al agua y al viento. Unisex, XS a XXL.",
  },
  "casaca-impermeable-wintertrainer": {
    title: "Casaca Impermeable Térmica Wintertrainer | Mondano Chile",
    desc: "Casaca Wintertrainer en poliamida con PU: 94 pulgadas de columna de agua y forro térmico Thermafleece. Con capucha y cuello alto. Unisex, XS a XXL.",
  },
  "casaca-impermeable-wintertrainer-edicion-limitada": {
    title: "Casaca Impermeable Wintertrainer Limitada | Mondano Chile",
    desc: "Casaca Wintertrainer edición limitada: poliamida con PU, forro térmico Thermafleece, capucha y cuello alto. Impermeable y transpirable. Unisex, XS a XXL.",
  },
  "casaca-velvet-fur": {
    title: "Casaca Impermeable Velvet Fur | Mondano Chile",
    desc: "Casaca Velvet Fur para ella, con capuchón de piel sintética y tela impermeable en poliamida con PU. De la ciudad a la montaña. Tallas XS a XXL.",
  },
  "chaqueta-la-black-fur": {
    title: "Chaqueta Impermeable con Forro Térmico | Mondano Chile",
    desc: "Chaqueta en Taslan Pu con forro Thermaheat Lite: 94 pulgadas de columna de agua, califica como impermeable. Unisex, XS a XXL. Envío a todo Chile.",
  },

  // ----------------------------------------------------------- cortavientos
  "purple-urban-windbreaker": {
    title: "Cortaviento Impermeable Purple Urban | Mondano Chile",
    desc: "Cortaviento Purple Urban en poliéster rip stop con poliuretano: repelente al agua, liviano y de secado rápido, con malla interior. Unisex, XS a XXL.",
  },
  "fuchsia-urban-windbreaker": {
    title: "Cortaviento Impermeable Fuchsia Urban | Mondano Chile",
    desc: "Cortaviento Fuchsia Urban en poliéster rip stop con poliuretano: repelente al agua, liviano y de secado rápido, con malla interior. Unisex, XS a XXL.",
  },
  "cortaviento-pistachio-spring-trend": {
    title: "Cortaviento Impermeable Pistachio | Mondano Chile",
    desc: "Cortaviento Pistachio en poliéster reciclado con exterior impermeable. Cuello alto, capucha con cordón, puños elásticos y cierre de cremallera. Unisex.",
  },
  "cortaviento-orange-spring-trend": {
    title: "Cortaviento Impermeable Orange | Mondano Chile",
    desc: "Cortaviento Orange en poliéster reciclado con exterior impermeable. Cuello alto, capucha con cordón, puños elásticos y cierre de cremallera. Unisex, XS a XXL.",
  },
  "cortaviento-purple-spring-trend": {
    title: "Cortaviento Impermeable Purple | Mondano Chile",
    desc: "Cortaviento Purple en poliéster reciclado con exterior impermeable. Cuello alto, capucha con cordón, puños elásticos y cierre de cremallera. Unisex, XS a XXL.",
  },
  "cortaviento-ashes": {
    title: "Cortaviento Impermeable Ashes | Mondano Chile",
    desc: "Cortaviento Ashes liviano, repelente al agua y al viento, con forro térmico Thermaheat Lite. Para noches, playas y montaña. Unisex, XS a XXL. Envío a Chile.",
  },
  "cortaviento-women-crop-lavender": {
    title: "Cortaviento Impermeable Crop Lavender | Mondano Chile",
    desc: "Cortaviento crop Lavender en poliéster rip stop con poliuretano, capucha con cuello y corte cropped. Liviano y repelente al agua. Tallas XS a XXL.",
  },
  "cortaviento-women-crop-pinkadelic": {
    title: "Cortaviento Impermeable Crop Pinkadelic | Mondano Chile",
    desc: "Cortaviento crop Pinkadelic en poliéster rip stop con poliuretano, capucha con cuello y corte cropped. Liviano y repelente al agua. Tallas XS a XXL.",
  },
  "cortaviento-color-block-expedition": {
    title: "Cortaviento Impermeable Color Block | Mondano Chile",
    desc: "Cortaviento Color Block en Taslan Pu con forro térmico Thermaheat Lite: impermeable, liviano y ajustable. Para noches, playas y montañas. Unisex, XS a XXL.",
  },
  "cortavientos-trail-traveler": {
    title: "Cortaviento Impermeable Trail Traveler | Mondano Chile",
    desc: "Cortaviento Trail Traveler con capucha ajustable, bolsillos laterales e interior. Impermeable, térmico y liviano: ocupa poco espacio al viajar. XS a XXL.",
  },
  "pistachio-beach-windbreaker": {
    title: "Cortaviento Impermeable Pistachio Beach | Mondano Chile",
    desc: "Cortaviento Pistachio Beach en poliamida con PU: 94 pulgadas de columna de agua, califica impermeable. Sin capucha, con bolsillos. Unisex, XS a XXL.",
  },
  "cortaviento-susurro-del-bosque": {
    title: "Cortaviento Impermeable Susurro del Bosque | Mondano Chile",
    desc: "Cortaviento para ella Susurro del Bosque: tipo bomber con corte crop y capucha, en poliéster rip stop con poliuretano. Tonos neutros. Tallas XS a XXL.",
  },

  // ---------------------------------------------------------------- abrigos
  "chiporro-brown": {
    title: "Abrigo de Chiporro con Forro Fleece | Mondano Chile",
    desc: "Abrigo de chiporro con exterior 100% poliéster e interior fleece, cierre por lazo y bolsillos laterales. Disponible en versión chaqueta y abrigo. Envío a Chile.",
  },
  "abrigo-tedd-a-cuadros": {
    title: "Abrigo de Bouclé Estampado a Cuadros | Mondano Chile",
    desc: "Abrigo para ella en tela fantasía de poliéster 100%, con textura bouclé y estampado a cuadros. Para las fechas más frescas. XS a XXL. Envío a todo Chile.",
  },
  "abrigo-zebra-teddy-coat": {
    title: "Abrigo Zebra Teddy Coat | Mondano Chile",
    desc: "Abrigo tipo teddy coat con estampado zebra en 100% poliéster. Con carácter, para combinar con lo que sea. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "abrigo-camel-leather": {
    title: "Abrigo de Ecocuero Camel | Mondano Chile",
    desc: "Abrigo de ecocuero (50% poliéster y 50% PU) en color camel. No se lava: se limpia con un paño húmedo y se ventila. XS a XXL. Envío a Chile.",
  },
  "denim-jacket": {
    title: "Chaqueta de Denim Azul con Serigrafía | Mondano Chile",
    desc: "Chaqueta de jeans azul con serigrafía y textos minimalistas: elegante y urbano a la vez. Combínala con un pantalón o un polerón oversize. Tallas S a XL.",
  },
};

(async () => {
  const shop = process.env.SHOPIFY_SHOP;
  const t = await (
    await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID,
        client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    })
  ).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = `https://${shop}.myshopify.com/admin/api/2026-01`;
  const gql = async (query, variables) => {
    const r = await (
      await fetch(A + "/graphql.json", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ query, variables }),
      })
    ).json();
    if (r.errors) {
      console.log("   (!) " + JSON.stringify(r.errors).slice(0, 260));
      return null;
    }
    return r.data;
  };

  const ps = [];
  let after = null;
  for (let i = 0; i < 4; i++) {
    const q =
      "{ products(first: 40" +
      (after ? `, after: "${after}"` : "") +
      ', query: "status:active") { nodes { id handle title seo { title description } } pageInfo { hasNextPage endCursor } } }';
    const j = await gql(q);
    if (!j || !j.products) break;
    ps.push(...j.products.nodes);
    if (!j.products.pageInfo.hasNextPage) break;
    after = j.products.pageInfo.endCursor;
  }
  const porHandle = new Map(ps.map((p) => [p.handle, p]));

  const faltan = Object.keys(FICHAS).filter((h) => !porHandle.has(h));
  if (faltan.length) {
    console.log("  ERROR: estas fichas no existen: " + faltan.join(", "));
    return;
  }

  let conError = 0;
  for (const [handle, cfg] of Object.entries(FICHAS)) {
    const p = porHandle.get(handle);
    const antes = p.seo.title + " || " + (p.seo.description || "");
    const cambia = p.seo.title !== cfg.title || p.seo.description !== cfg.desc;
    const marca = cambia ? "cambia" : "igual ";
    if (cfg.title.length > 60) console.log(`  (!) ${handle}: title de ${cfg.title.length} car.`);
    if (cfg.desc.length > 160 || cfg.desc.length < 120)
      console.log(`  (!) ${handle}: desc de ${cfg.desc.length} car.`);
    console.log(`  ${marca}  ${handle}`);
    console.log(`      - ${p.seo.title}`);
    console.log(`      + ${cfg.title}`);
    if (!APLICAR) continue;

    const r = await gql(
      `mutation($p: ProductUpdateInput!) {
        productUpdate(product: $p) {
          product { id handle seo { title description } }
          userErrors { message field }
        }
      }`,
      { p: { id: p.id, seo: { title: cfg.title, description: cfg.desc } } }
    );
    const ue = r && r.productUpdate ? r.productUpdate.userErrors : null;
    if (!r || !r.productUpdate) {
      console.log("      ERROR: la mutation no respondio");
      conError++;
      continue;
    }
    if (ue && ue.length) {
      console.log("      ERROR " + JSON.stringify(ue).slice(0, 200));
      conError++;
      continue;
    }
    const nuevo = r.productUpdate.product.seo;
    if (nuevo.title !== cfg.title || nuevo.description !== cfg.desc) {
      console.log("      ERROR: Shopify guardo algo distinto a lo pedido");
      conError++;
    }
  }

  console.log(
    `\n  ${Object.keys(FICHAS).length} fichas | errores: ${conError}` +
      (APLICAR ? "" : "\n  (dry-run: no se escribio nada. Usa --aplicar)")
  );
})();
