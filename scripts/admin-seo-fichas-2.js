/**
 * Segunda tanda del Bloque 3: las 62 fichas que NO son de abrigo (polerones,
 * conjuntos, vestidos, camisas, pantalones, polera y falda).
 *
 *   node scripts/admin-seo-fichas-2.js            -> dry-run
 *   node scripts/admin-seo-fichas-2.js --aplicar   -> escribe
 *
 * Antes estas fichas tenian la meta description autogenerada
 * ("Material resistente de uso diario. Ideal para el frio y el dia a dia
 * urbano."), que es texto generico y no aporta nada en el resultado de
 * Google. Ahora cada una dice que tela es, que lleva y para que clima sirve,
 * sacado de la descripcion real del producto.
 *
 * Igual que en admin-seo-fichas.js: solo se escribe seo.title y
 * seo.description. No se tocan el titulo visible, el handle, el contenido,
 * los precios ni las variantes.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const FICHAS = {
  // ------------------------------------------------------ polerones (34)
  "poleron-casual": {
    title: "Polerón Unisex Oversize Casual | Mondano Chile",
    desc: "Polerón Casual en franela de algodón (70% algodón, 30% poliéster): cuello alto, capucha y bolsillo canguro. Filtro UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-multicolor": {
    title: "Polerón Unisex Oversize Multicolor | Mondano Chile",
    desc: "Polerón Multicolor en franela de algodón (70% algodón, 30% poliéster), calce oversize, cuello alto con capucha y bolsillo canguro. UPF 50+. XS a XXL.",
  },
  "new-colorful": {
    title: "Polerón Unisex New Colorful | Mondano Chile",
    desc: "Polerón New Colorful en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-bard-evolution": {
    title: "Polerón Unisex Bard Evolution | Mondano Chile",
    desc: "Polerón Bard Evolution en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-kangaru": {
    title: "Polerón Unisex Kangaru | Mondano Chile",
    desc: "Polerón Kangaru en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo frontal con cierre. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-adventure": {
    title: "Polerón Térmico Adventure | Mondano Chile",
    desc: "Polerón Adventure en franela con carda, por eso es térmico: cuello alto con capucha y doble bolsillo en el pecho. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-sunflower": {
    title: "Polerón Térmico Sunflower | Mondano Chile",
    desc: "Polerón Sunflower en franela con carda, que abriga más que la franela lisa: cuello alto, capucha y bolsillo frontal. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-1": {
    title: "Polerón Térmico Blaze | Mondano Chile",
    desc: "Polerón Blaze en franela con carda: cuello alto con capucha, bolsillo frontal y bolsillos laterales. Tela de alta gama que no se encoge. Unisex, XS a XXL.",
  },
  "poleron-urban": {
    title: "Polerón Térmico Urban | Mondano Chile",
    desc: "Polerón Urban en franela con carda, con cuello alto, capucha y ajuste regular. Tela suave y durable que no se encoge. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-autumn-urban-fashion": {
    title: "Polerón Térmico Autumn Urban Fashion | Mondano Chile",
    desc: "Polerón Autumn Urban Fashion en franela con carda, con cuello alto, capucha y ajuste regular. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-autumn-urban-fashion-blue": {
    title: "Polerón Térmico Autumn Urban Fashion Azul | Mondano Chile",
    desc: "Polerón Autumn Urban Fashion en azul, en franela con carda: cuello alto, capucha y ajuste regular. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-autumn-pistachio": {
    title: "Polerón Térmico Autumn Pistachio | Mondano Chile",
    desc: "Polerón Autumn Pistachio en franela con carda, con cuello alto y capucha. UPF 50+, ajuste regular. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-nostalgic": {
    title: "Polerón Unisex Nostalgic | Mondano Chile",
    desc: "Polerón Nostalgic en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-canguro-azul": {
    title: "Polerón Unisex Canguro Azul | Mondano Chile",
    desc: "Polerón Canguro en azul: franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-blue-colors": {
    title: "Polerón Unisex Blue Colors | Mondano Chile",
    desc: "Polerón Blue Colors en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-black-colors": {
    title: "Polerón Unisex Black Colors | Mondano Chile",
    desc: "Polerón Black Colors en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-mike-celeste": {
    title: "Polerón Térmico Mike Celeste | Mondano Chile",
    desc: "Polerón de la colección Pablo Mike en franela con carda: cuello alto, capucha y ajuste regular. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-mike-rosado": {
    title: "Polerón Térmico Mike Rosado | Mondano Chile",
    desc: "Polerón de la colección Pablo Mike en franela con carda: cuello alto, capucha y ajuste regular. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-mike-verde": {
    title: "Polerón Térmico Mike Verde | Mondano Chile",
    desc: "Polerón de la colección Pablo Mike en franela con carda: cuello alto, capucha y ajuste regular. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-manga-murcielago-exclusive": {
    title: "Polerón Manga Murciélago | Mondano Chile",
    desc: "Polerón manga murciélago en franela de algodón (70% algodón, 30% poliéster), cuello alto con capucha y bolsillo canguro. UPF 50+. Unisex, XS a 2XL.",
  },
  "crop-top-naranja": {
    title: "Polerón Crop Top Naranja | Mondano Chile",
    desc: "Polerón crop top naranja en franela de algodón (70% algodón, 30% poliéster): cuello redondo, sin capucha, con puño y bajo elástico. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-crop-top-fucsia": {
    title: "Polerón Crop Top Fucsia | Mondano Chile",
    desc: "Polerón crop top fucsia en franela de algodón (70% algodón, 30% poliéster): cuello redondo, sin capucha, con puño y bajo elástico. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-crop-top-amarillo": {
    title: "Polerón Crop Top Amarillo | Mondano Chile",
    desc: "Polerón crop top amarillo en franela de algodón (70% algodón, 30% poliéster): cuello redondo, sin capucha, con puño y bajo elástico. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-hoodie-morado": {
    title: "Polerón Hoodie Morado | Mondano Chile",
    desc: "Polerón hoodie morado en franela de algodón con puño, cierre completo, cuello con gorro y bolsillos con cierre. UPF 50+. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-hoodie-yellow": {
    title: "Polerón Hoodie Amarillo | Mondano Chile",
    desc: "Polerón hoodie en franela de algodón con puño, cierre completo, cuello con gorro y bolsillo canguro. UPF 50+, en amarillo, rojo, verde y azul. Unisex, XS a XXL.",
  },
  "poleron-icon": {
    title: "Polerón Unisex Icon | Mondano Chile",
    desc: "Polerón Icon en franela de algodón (70% algodón, 30% poliéster), cuello con gorro y bolsillo canguro. Filtro UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-belair": {
    title: "Polerón Oversize Belair | Mondano Chile",
    desc: "Polerón Belair oversize en franela de algodón: movimiento fluido y suavidad máxima. Unisex, para toda la temporada. Tallas XS a XXL. Envío a todo Chile.",
  },
  "poleron-urban-personality": {
    title: "Polerón de Fleece Urban Personality | Mondano Chile",
    desc: "Polerón Urban Personality en fleece: tejido flexible, esponjoso y aterciopelado, que abriga sin pesar. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-urban-identity": {
    title: "Polerón de Fleece Urban Identity | Mondano Chile",
    desc: "Polerón Urban Identity con forro interior de fleece: tejido flexible, esponjoso y aterciopelado, que abriga sin pesar. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-duffle-cropped": {
    title: "Polerón Crop Duffle | Mondano Chile",
    desc: "Polerón Duffle cropped en franela con carda, en beige y café. Tejido con filtro UPF 50+ y puño ribeteado. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-ambarino": {
    title: "Polerón Oversize Ambarino | Mondano Chile",
    desc: "Polerón Ambarino oversize con zip-up completo, capucha ajustable de cordones con puntas doradas y bolsillo kangaroo grande. Unisex, XS a XXL. Envío a Chile.",
  },
  "poleron-mondano-trend": {
    title: "Polerón Unisex Mondano Trend | Mondano Chile",
    desc: "Polerón Mondano Trend en franela de algodón (70% algodón, 30% poliéster), de diseño de tendencia, con cuello alto y capucha. UPF 50+. Unisex, XS a XXL.",
  },
  "poleron-mondano-orange": {
    title: "Polerón Unisex Mondano Orange | Mondano Chile",
    desc: "Polerón Mondano Orange en franela de algodón (70% algodón, 30% poliéster), con cuello alto y capucha. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },
  "poleron-mondano-green": {
    title: "Polerón Unisex Mondano Green | Mondano Chile",
    desc: "Polerón Mondano Green en franela de algodón (70% algodón, 30% poliéster), con cuello alto y capucha. UPF 50+. Unisex, XS a XXL. Envío a todo Chile.",
  },

  // ------------------------------------------------------ conjuntos (12)
  "conjunto-casual": {
    title: "Conjunto de Polerón y Pantalón Casual | Mondano Chile",
    desc: "Conjunto casual de dos piezas en franela de algodón: polerón con cuello alto, capucha y bolsillo canguro, más pantalón con puños y rodillas elásticas. XS a XXL.",
  },
  "conjunto-multicolor": {
    title: "Conjunto Multicolor de Polerón y Pantalón | Mondano Chile",
    desc: "Conjunto Multicolor en franela de algodón: polerón con cuello alto, capucha y bolsillo canguro, y pantalón con costilla en las piernas. Unisex, XS a XXL.",
  },
  "conjunto-multicolor-1": {
    title: "Conjunto New Colorful de Dos Piezas | Mondano Chile",
    desc: "Conjunto New Colorful en franela de algodón: polerón con cuello alto, capucha y bolsillo canguro, y pantalón con puños y rodillas elásticas. Unisex, XS a XXL.",
  },
  "conjunto-cargo-wind": {
    title: "Conjunto Cargo Wind | Mondano Chile",
    desc: "Conjunto Cargo Wind en franela de algodón: polerón con cuello alto, capucha y bolsillo canguro, y pantalón de pierna ancha con carteras. Tallas XS a XXL.",
  },
  "conjunto-crop-top": {
    title: "Conjunto Crop Top y Pantalón | Mondano Chile",
    desc: "Conjunto crop top en franela de algodón: polerón con cierre y elástico ajustable, cuello alto, y pantalón de pierna ancha con carteras. Tallas XS a XXL.",
  },
  "conjunto-abstract-flowers": {
    title: "Conjunto Floral Abstract Flowers | Mondano Chile",
    desc: "Conjunto de dos piezas: blusa crop de manga corta con bolsillos delanteros y falda cruzada asimétrica semi plato. Tallas XS a XXL. Envío a todo Chile.",
  },
  "conjunto-dos-piezas-susurro-de-olas": {
    title: "Conjunto Dos Piezas Susurro de Olas | Mondano Chile",
    desc: "Conjunto de dos piezas con top crop y falda larga hasta los pies en corte A, con estampado floral en azul marino. Tallas XS a XXL. Envío a todo Chile.",
  },
  "conjunto-dos-piezas-susurro-de-atardecer": {
    title: "Conjunto Dos Piezas Susurro de Atardecer | Mondano Chile",
    desc: "Conjunto de dos piezas boho: top tipo tube con corte crop y falda larga hasta los tobillos, en flores rojas. Tallas XS a XXL. Envío a todo Chile.",
  },
  "fucsia-bold": {
    title: "Conjunto Fucsia Bold | Mondano Chile",
    desc: "Conjunto Fucsia Bold en fucsia intenso: polerón con capucha, cierre frontal y bolsillos, más pantalón con cordón y bolsillos laterales. Unisex, XS a XXL.",
  },
  "conjunto-copacabana": {
    title: "Conjunto Guinda Copacabana | Mondano Chile",
    desc: "Conjunto Copacabana con lentejuelas, top strapless, mini falda y una bufanda larga del mismo tejido. Para fiestas de verano. Tallas XS a XL. Envío a Chile.",
  },
  "conjunto-ipanema": {
    title: "Conjunto Ipanema Tropical | Mondano Chile",
    desc: "Conjunto Ipanema de dos piezas: top halter semitransparente y falda tipo pareo con abertura lateral. Para playa, vacaciones o atardecer. Tallas XS a XL.",
  },
  "conjunto-comfy-urbano": {
    title: "Conjunto Comfy Urbano de Dos Piezas | Mondano Chile",
    desc: "Conjunto Comfy Urbano en franela de algodón de media carda: polerón y pantalón holgados, de confección 100% chilena. Tallas XS a 2XL. Envío a todo Chile.",
  },

  // ------------------------------------------------------ vestidos (8)
  "vestido-tirantes-full-colors": {
    title: "Vestido Maxi de Tirantes | Mondano Chile",
    desc: "Vestido maxi de tirantes con cuello alto y amarras ajustables para acomodar el escote a tu medida. Tallas XS a XXL. Envío a todo Chile.",
  },
  "vestido-animal-print": {
    title: "Vestido de Punto Animal Print | Mondano Chile",
    desc: "Vestido en punto estampado animal print: mezcla de suavidad, calidez y durabilidad, con diseño rib. Look casual sin perder elegancia. Tallas XS a XXL.",
  },
  "vestido-punto-coquette": {
    title: "Vestido de Punto Coquette | Mondano Chile",
    desc: "Vestido de punto en 93,5% poliéster y 6,5% elastano: suave, durable y flexible. Combínalo con botas o zapatillas. Tallas XS a XXL. Envío a Chile.",
  },
  "vestido-olas-nomadas": {
    title: "Vestido Largo Olas Nómadas | Mondano Chile",
    desc: "Vestido largo tipo halter neck con amarras al cuello, hombros y espalda al descubierto, en estampado de olas azules. Tallas XS a XXL. Envío a Chile.",
  },
  "vestido-brisa-de-verano": {
    title: "Vestido Largo Brisa de Verano | Mondano Chile",
    desc: "Vestido largo (midi o maxi) con tirantes finos, falda recta con vuelo natural y estampado floral sutil. Tallas XS a XXL. Envío a todo Chile.",
  },
  "vestido-brisa-carioca": {
    title: "Vestido Largo Brisa Carioca | Mondano Chile",
    desc: "Vestido largo con escote halter, tela translúcida con movimiento y abertura frontal en la falda. Para el verano y la noche. Tallas XS a XL. Envío a Chile.",
  },
  "vestido-samba-rose": {
    title: "Vestido Mini Samba Rosé | Mondano Chile",
    desc: "Vestido mini strapless en lentejuelas brillantes, con ajuste ceñido al cuerpo. Glam veraniego para las noches de verano. Tallas XS a XL. Envío a Chile.",
  },
  "vestido-eolo": {
    title: "Vestido Largo Eolo | Mondano Chile",
    desc: "Vestido largo tipo pareo envolvente, con escote en V cruzado y mangas cortas de tirantes anchos atadas en los hombros. Tallas XS a XXL. Envío a Chile.",
  },

  // ----------------------------------------------------- pantalones (4)
  "black-baggy-jeans": {
    title: "Jeans Baggy Negros | Mondano Chile",
    desc: "Jeans negros de corte baggy, con cierres laterales que se abren y cierran e interior tipo militar. Talla única standard, de la 40 a la 44. Envío a Chile.",
  },
  "snake-baggy-jeans": {
    title: "Jeans Baggy Serpiente Negro | Mondano Chile",
    desc: "Jeans negros estilo baggy con textura tipo cuero de serpiente y cierres laterales. Talla única standard, de la 40 a la 44. Unisex. Envío a todo Chile.",
  },
  "straight-jeans": {
    title: "Jeans Recto con Serigrafía | Mondano Chile",
    desc: "Jeans azul de corte recto con estampado de serigrafía, el complemento perfecto para un outfit minimalista. Talla única, de la 40 a la 44. Envío a Chile.",
  },
  "pantalon-flow-maestro": {
    title: "Pantalón Flow Maestro | Mondano Chile",
    desc: "Pantalón Flow Maestro ancho y texturizado, con cintura alta y cordón blanco. Liviano y fresco, en tono beige/tierra. Tallas XS a XXL. Envío a Chile.",
  },

  // ---------------------------------------------------- camisas (2), polera (1), falda (1)
  "camisa-boho-arena-mao": {
    title: "Camisa Bohemia Arena con Cuello Mao | Mondano Chile",
    desc: "Camisa boho en tono arena con textura rugosa, cuello mao de borde marrón contrastante y manga larga. Fresca y transpirable. Tallas XS a XXL. Envío a Chile.",
  },
  "camisa-celeste-mao-costera": {
    title: "Camisa Bohemia Costera con Cuello Mao | Mondano Chile",
    desc: "Camisa boho en tono celeste con textura rugosa, cuello mao y manga larga. Fresca, cómoda y transpirable. Tallas XS a XXL. Envío a todo Chile.",
  },
  "polera-you-are-lucky": {
    title: "Polera Oversize You Are Lucky | Mondano Chile",
    desc: "Polera de algodón con diseño minimal y boxy fit cómodo, y el mensaje \"You Are Lucky\". Un básico que convierte cualquier outfit en statement. Tallas S a XL.",
  },
  "falda-camel-leather": {
    title: "Falda de Ecocuero Camel | Mondano Chile",
    desc: "Falda en ecocuero (50% poliéster y 50% PU), del mismo camel que nuestro abrigo. No se lava: se limpia con un paño húmedo y se ventila. Tallas XS a XXL.",
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
      console.log("   (!) " + JSON.stringify(r.errors).slice(0, 300));
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

  let errores = 0;
  for (const [handle, cfg] of Object.entries(FICHAS)) {
    const p = porHandle.get(handle);
    if (cfg.title.length > 60) console.log(`  (!) ${handle}: title de ${cfg.title.length} car.`);
    if (cfg.desc.length > 160 || cfg.desc.length < 120)
      console.log(`  (!) ${handle}: desc de ${cfg.desc.length} car.`);
    if (p.seo.title === cfg.title && p.seo.description === cfg.desc) {
      console.log(`  ${handle}: ya estaba OK`);
      continue;
    }
    if (!APLICAR) {
      console.log(`  ${p.seo.title}  ->  ${cfg.title}`);
      continue;
    }
    const r = await gql(
      `mutation($p: ProductUpdateInput!) {
        productUpdate(product: $p) {
          product { id handle seo { title description } }
          userErrors { message field }
        }
      }`,
      { p: { id: p.id, seo: { title: cfg.title, description: cfg.desc } } }
    );
    if (!r || !r.productUpdate) {
      console.log(`  ${handle}: ERROR la mutation no respondio`);
      errores++;
      continue;
    }
    const ue = r.productUpdate.userErrors;
    if (ue && ue.length) {
      console.log(`  ${handle}: ERROR ${JSON.stringify(ue).slice(0, 200)}`);
      errores++;
      continue;
    }
    const s = r.productUpdate.product.seo;
    if (s.title !== cfg.title || s.description !== cfg.desc) {
      console.log(`  ${handle}: ERROR Shopify guardo algo distinto`);
      errores++;
    }
  }

  console.log(
    `\n  ${Object.keys(FICHAS).length} fichas | errores: ${errores}` +
      (APLICAR ? "" : "\n  (dry-run: no se escribio nada. Usa --aplicar)")
  );
})();
