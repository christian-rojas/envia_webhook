/**
 * Contenido de marca y meta descripciones propias.
 *
 *   node scripts/admin-contenido-seo.js            -> dry-run
 *   node scripts/admin-contenido-seo.js --aplicar   -> escribe
 *
 * 1) "QUIENES SOMOS" estaba en 626 caracteres: es la pagina de E-E-A-T de
 *    la marca y era la mas corta de las indexables. Se reescribe con datos
 *    reales del catalogo (texturas, tallas, fit, plazos de envio, retail y
 *    politica de cambios), sin inventar nada.
 *
 * 2) Meta descripciones propias (namespace "seo", key "description") para:
 *    - las 2 paginas que no tenian (Politica de envio, Quienes somos)
 *    - los 5 articulos del blog (antes el theme las armaba recortando el
 *      contenido: funcionaban, pero eran el titulo + el primer parrafo).
 *
 * Las paginas ya escritas antes (mujer, hombre, unisex, novias, sale,
 * contacto, preguntas frecuentes, politicas) NO se tocan.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const QUIENES_SOMOS = `
<h2>Una marca chilena, de confección chilena</h2>
<p><strong>MONDANO</strong> nació para renovar la moda nacional: diseñamos y confeccionamos en Chile prendas con la gama de colores y estampados del momento, para que te veas único(a) y a gusto. Y lo hacemos sin discriminar por género: nuestra colección es <strong>unisex</strong> de principio a fin, porque no existen colores exclusivos para un determinado género.</p>

<h2>Qué vas a encontrar</h2>
<p>Polerones, parkas, casacas, cortavientos, abrigos, conjuntos de dos piezas, vestidos, camisas, pantalones, poleras y shorts. Con las texturas que de verdad se usan en este país: <strong>franela</strong> y <strong>algodón</strong> para el día a día, <strong>Taslan</strong> y <strong>poliamida</strong> impermeables para la lluvia, <strong>denim</strong>, <strong>Thermaheat</strong> y forros de <strong>fleece</strong> y <strong>chiporro</strong> para el frío de verdad.</p>

<h2>El fit: casi todo relajado u oversize</h2>
<p>No somos una marca slim fit. Polerones, parkas, casacas y cortavientos están pensados para que te sientas cómodo, puedas poner una capa debajo y todavía te quede con buen drapeado. Si te gusta la ropa amplia, vas a estar en tu salsa.</p>
<p>Trabajamos de la <strong>XS a la XXL</strong>, más talla única en algunos modelos. Si dudas con la talla, mide una prenda que te quede bien y compárala con nuestra <a href="/pages/guia-de-tallas">guía de tallas</a>.</p>

<h2>Despachamos a todo Chile</h2>
<p>Preparamos tu pedido en <strong>1 a 3 días hábiles</strong> desde que se confirma el pago. La Región Metropolitana lo recibe en <strong>3 días hábiles</strong> y el resto del país entre <strong>5 y 7 días hábiles</strong>, con Envia. El costo de envío se calcula al finalizar la compra, según la comuna de entrega y el tamaño y peso del pedido.</p>
<p>Si prefieres verlo antes de comprarlo online, también nos encuentras en <a href="https://simple.ripley.cl/tienda/mondano-3620" rel="noopener" target="_blank">Ripley</a> y <a href="https://www.falabella.com/falabella-cl/seller/Mondano" rel="noopener" target="_blank">Falabella</a>. Todos los detalles en la <a href="/pages/politica-de-envio">política de envío</a>.</p>

<h2>Cambios y devoluciones</h2>
<p>El cambio se puede solicitar hasta <strong>30 días</strong> desde que recibiste el pedido, y la devolución hasta <strong>10 días</strong> (Art. 21, ley 19.496). La información completa está en nuestra <a href="/pages/politica-de-cambio-y-devoluciones-1">política de cambios y devoluciones</a>.</p>

<h2>¿Tienes dudas?</h2>
<p>Escríbenos por WhatsApp al <a href="https://wa.me/56929773980">+56 9 2977 3980</a> o al <a href="mailto:contacto@mondano.cl">contacto@mondano.cl</a>, con tu número de pedido (ejemplo: MON4724). Si buscas otra talla, otra prenda o solo quieres comparar modelos, te orientamos.</p>
`.trim();

const META = {
  paginas: [
    {
      handle: "quienes-somos",
      desc: "MONDANO es una marca de moda chilena: diseño y confección en Chile, prendas unisex de la XS a la XXL en franela, denim y telas impermeables. Envíos a todo Chile.",
    },
    {
      handle: "politica-de-envio",
      desc: "Preparamos tu pedido en 1 a 3 días hábiles. Entrega en 3 días hábiles en Región Metropolitana y de 5 a 7 en el resto de Chile, con Envia. Acá todos los detalles.",
    },
  ],
  articulos: [
    {
      handle: "como-elegir-tu-talla",
      desc: "El fit de MONDANO es relajado u oversize. Te explicamos cómo medirte, cómo compararte con una prenda que ya te queda bien y qué talla pedir para no quedarte corto.",
    },
    {
      handle: "que-ponerse-cuando-llueve-en-chile",
      desc: "Impermeable o repelente al agua: la diferencia que importa, qué ponerse cuando llueve fuerte en la costa o en el sur y cómo no terminar empapado.",
    },
    {
      handle: "como-combinar-un-poleron-oversize",
      desc: "5 formas reales de combinar un polerón oversize: con pantalón cargo, con denim, con chaqueta y más. Looks urbanos sin tener que esforzarte ni combinar estilos raros.",
    },
    {
      handle: "como-cuidar-tu-ropa-para-que-dure",
      desc: "Agua fría, nunca secadora y el resto de los hábitos que hacen que un polerón o una parka se vean nuevos por mucho más tiempo. Guía simple de cuidado.",
    },
    {
      handle: "poleron-o-parka-como-elegir",
      desc: "No es cuestión de estilo sino de clima: cuándo ponerte un polerón y cuándo una parka, según la estación, la lluvia y el frío de la ciudad donde vives.",
    },
  ],
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
    if (r.errors) console.log("   (!) " + JSON.stringify(r.errors).slice(0, 240));
    return r.data;
  };

  const jp = await gql(`{ pages(first: 40) { nodes { id handle title body publishedAt } } }`);
  const paginas = jp.pages.nodes;
  const ja = await gql(`{ articles(first: 20) { nodes { id handle title publishedAt } } }`);
  const articulos = ja.articles.nodes;

  console.log("\n  === PAGINAS ===");
  const aAplicar = [];
  for (const m of META.paginas) {
    const p = paginas.find((x) => x.handle === m.handle);
    if (!p) {
      console.log(`  (no existe la pagina "${m.handle}")`);
      continue;
    }
    const larga = m.handle === "quienes-somos";
    const antes = (p.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
    console.log(`  ${p.title}`);
    console.log(`     texto: ${antes} -> ${larga ? QUIENES_SOMOS.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length : antes} chars`);
    console.log(`     meta desc: ${m.desc.length} chars`);
    aAplicar.push({ tipo: "pagina", p, m, larga });
  }

  console.log("\n  === ARTICULOS ===");
  for (const m of META.articulos) {
    const a = articulos.find((x) => x.handle === m.handle);
    if (!a) {
      console.log(`  (no existe el articulo "${m.handle}")`);
      continue;
    }
    console.log(`  ${a.title}`);
    console.log(`     meta desc: ${m.desc.length} chars`);
    aAplicar.push({ tipo: "articulo", p: a, m, larga: false });
  }

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  console.log("\n=== aplicando ===");
  for (const x of aAplicar) {
    if (x.larga) {
      const r = await gql(
        `mutation($id: ID!, $b: String!) { pageUpdate(id: $id, page: {body: $b}) { page { id title } userErrors { message } } }`,
        { id: x.p.id, b: QUIENES_SOMOS }
      );
      const ue = r && r.pageUpdate ? r.pageUpdate.userErrors : null;
      console.log(`  texto de "${x.p.title}": ` + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 160) : "OK"));
    }
    const rm = await gql(
      `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { namespace key value } userErrors { message field } } }`,
      { m: [{ ownerId: x.p.id, namespace: "seo", key: "description", type: "single_line_text_field", value: x.m.desc }] }
    );
    const uem = rm && rm.metafieldsSet ? rm.metafieldsSet.userErrors : null;
    console.log(`  meta desc de "${x.p.title}": ` + (uem && uem.length ? "ERROR " + JSON.stringify(uem).slice(0, 160) : "OK (" + x.m.desc.length + " chars)"));
  }
})();
