/**
 * Bloque 4 del plan SEO: los 4 articulos de blog, programados para abril 2027
 * (fecha pedida por el merchant el 22-12-2026), para que queden indexados
 * antes de que suba la demanda de autumno-invierno.
 *
 *   node scripts/admin-seo-articulos.js            -> dry-run
 *   node scripts/admin-seo-articulos.js --aplicar   -> crea los articulos
 *   node scripts/admin-seo-articulos.js --hoy       -> los publica HOY (prueba)
 *
 * NOTA: Shopify NO acepta isPublished:true junto a una fecha futura ("Can't
 * set isPublished to true and also set a future publish date"). Para
 * programar un articulo hay que mandarlo con isPublished:false y la fecha
 * futura: eso lo deja agendado y Shopify lo publica solo el dia indicado.
 *
 * Cada articulo:
 *   - title con la query objetivo al principio
 *   - respuesta directa en las dos primeras frases
 *   - 2-4 enlaces internos con anchor text descriptivo
 *   - meta description propia en el metafield seo.description
 *   - 700-1000 palabras, con datos reales de los productos
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const HOY = process.argv.includes("--hoy");
const BLOG = "gid://shopify/Blog/83483230431";
const MES = "2027-04";

// Fechas de publicacion: una por semana en abril 2027.
const FECHAS = {
  "diferencia-entre-parka-y-casaca": "2027-04-06T12:00:00Z",
  "como-elegir-cortaviento-impermeable": "2027-04-13T12:00:00Z",
  "parka-o-cortaviento-impermeable": "2027-04-20T12:00:00Z",
  "como-lavar-una-parka-impermeable": "2027-04-27T12:00:00Z",
};

const ARTICULOS = [
  {
    handle: "diferencia-entre-parka-y-casaca",
    title: "Diferencia entre parka y casaca: cuál elegir",
    date: FECHAS["diferencia-entre-parka-y-casaca"],
    tags: ["parkas", "casacas", "invierno"],
    desc:
      "Parka o casaca: la diferencia está en el largo, el forro y el abrigo. Te explicamos cuál elegir según el frío, la lluvia y cómo te gusta vestir.",
    body: `<h2>Diferencia entre parka y casaca: cuál elegir</h2>
<p>La diferencia entre parka y casaca está en el largo y en el abrigo: la <strong>parka</strong> es la prenda larga, llega sobre la rodilla y va con capucha, cierre completo y forro térmico; la <strong>casaca</strong> es la versión corta, hasta la cintura, más liviana y también impermeable. Si el frío y la lluvia están de manifiesto, parka; si hace fresco y quieres algo que te pongas todos los días, casaca.</p>
<p>En Mondano las dos son <strong>unisex</strong> y van de la XS a la XXL. Ninguna es "de hombre" ni "de mujer": eliges por el largo, el peso y cuánta temperatura le pides a la prenda.</p>
<h3>Parka: la larga, la de abrigo real</h3>
<p>Es la prenda que corta el frío de verdad. Al llegar sobre la rodilla protege muslos y rodillas, y lo que marca la diferencia es el forro: <strong>Thermaheat Lite</strong>, una tela delgada que rebota los rayos infrarrojos que emite el cuerpo, o <strong>Thermafleece 300</strong>, un forro flexible y aterciopelado de unos 2 cm. El exterior es <strong>Taslan Rip</strong> 100% impermeable o poliamida con poliuretano, y varias versiones traen cierre completo con broches.</p>
<p>Los hay de dos estilos: las tipo <strong>leñadora</strong>, con forro de chiporro y cierre con broches, pensadas para el invierno de verdad; y las más livianas, tipo <strong>Marquam Peak</strong>, <strong>Ruster</strong> o <strong>Blizzard</strong>, con forro térmico fino y calce oversize, que se llevan encima de otra prenda. La <strong>Jackdaw</strong> va con capucha o sin capucha, según la versión.</p>
<p>Si quieres ver las opciones largas: <a href="/collections/parkas">parkas impermeables</a>.</p>
<h3>Casaca: la corta, la de todos los días</h3>
<p>Es la misma idea de abrigo en versión corta: <strong>Taslan Rip</strong> afuera, <strong>Thermaflecee 300</strong> o <strong>Thermaheat Lite</strong> adentro, y capucha o gorro de polerón según el modelo. Pesa menos, entra al bolso y no estorba para sitting. Es la que usa quien quiere impermeable sin parecer que va de viaje.</p>
<p>La <strong>Wintertrainer</strong> va con cuello alto, capucha y cremallera completa con solapa; la <strong>Collor</strong> lleva el mismo forro pero sin gorro; y la <strong>Capucha Polerón</strong> suma un gorro de franelá de algodón. También existen las <strong>Casaca o Parka ICONIC</strong>, que vienen en las dos versiones: corta hasta la cadera o larga sobre las rodillas, con el mismo precio y el mismo forro de 2 cm. Si te gusta una y no sabes qué largo tomar, esa es la forma de comprar las dos sin decidir.</p>
<p>Si quieres ver las opciones cortas: <a href="/collections/casacas">casacas impermeables</a>.</p>
<h3>Cuál comprar, según el día</h3>
<ul>
<li><strong>Llueve fuerte y hace frío</strong>: parka, sin discusión.</li>
<li><strong>Llueve pero hace fresco</strong>: casaca, o incluso un <a href="/collections/cortavientos">cortaviento impermeable</a>.</li>
<li><strong>La ciudad, la oficina, todos los días</strong>: casaca. Es más liviana y no te cansa usarla.</li>
<li><strong>Cordillera o viajes largos</strong>: parka. El largo y el forro térmico no se reemplazan.</li>
<li><strong>Te da lo mismo el largo</strong>: mira el forro. Chiporro o Thermafleece 300 es abrigo real; Thermaheat Lite es una capa liviana.</li>
</ul>
<h3>Mira la tela, no solo el nombre</h3>
<p>Ojo con una cosa: "impermeable" no siempre significa lo mismo. Hay prendas que solo <strong>repelen el agua</strong> (aguantan un rato y después dejan pasar) y prendas que la <strong>bloquean</strong>. Si quieres saber cuál es cuál y qué material elegir según el clima, está todo en la <a href="/pages/impermeables">guía de prendas impermeables</a>.</p>
<h3>Y la talla</h3>
<p>Ambas van de XS a XXL y son de corte holgado. La forma más segura de elegir es medir una prenda que te quede bien y comparar las medidas con la <a href="/pages/guia-de-tallas">guía de tallas</a>. Ojo con las <strong>ICONIC</strong>: son modelos grandes y de confección nacional, así que el tallaje corre un poco más que el de las marcas importadas. Si te queda alguna duda, escríbenos al <a href="https://wa.me/56929773980">WhatsApp +56 9 2977 3980</a> y te ayudamos a elegir.</p>`,
  },
  {
    handle: "como-elegir-cortaviento-impermeable",
    title: "Cómo elegir un cortaviento impermeable",
    date: FECHAS["como-elegir-cortaviento-impermeable"],
    tags: ["cortavientos", "impermeable", "guía"],
    desc:
      "Cortaviento impermeable: mira la tela (repelente al agua o impermeable), el forro, la capucha y la talla. Guía corta para elegir el tuyo sin equivocarte.",
    body: `<h2>Cómo elegir un cortaviento impermeable</h2>
<p>Un buen cortaviento impermeable cumple tres cosas: que no te moje, que el viento no te enfríe y que ocupe poco espacio en la mochila. Para elegir bien, mira cuatro cosas: la tela, el forro, la capucha y la talla.</p>
<h3>1. La tela: repelente al agua o impermeable de verdad</h3>
<p>El cortaviento impermeable de verdad tiene <strong>poliamida o poliéster con poliuretano</strong> en la cara exterior, y se midió en <strong>94 pulgadas de columna de agua</strong>. Ese es el número que dice que el agua no pasa, y es el mismo de nuestros modelos más técnicos: la <strong>Wintertrainer</strong>, la <strong>Velvet Fur</strong>, la <strong>Black Fur</strong> y el <strong>Pistachio Beach</strong>.</p>
<p>El <strong>repelente al agua</strong> es otra cosa: tela <strong>rip stop</strong> con terminación de poliuretano, que deja resbalar el agua y seca rápido, pero no aguanta horas de lluvia. Es el caso de los modelos <strong>Urban</strong>, los <strong>Spring Trend</strong> y los <strong>crop</strong>. Para la ciudad son perfectos; para el sur y la cordillera, no.</p>
<p>La <a href="/pages/impermeables">guía de prendas impermeables</a> explica la diferencia completa, con la tela de cada modelo.</p>
<h3>2. El forro: ¿hace frío o no?</h3>
<ul>
<li><strong>Solo malla interior</strong>: cortaviento de primavera-verano. Lo más liviano que existe. Los <strong>Spring Trend</strong> son de esta línea y además están hechos con <strong>poliéster reciclado</strong>, tanto el exterior como el forro.</li>
<li><strong>Forro térmico fino (Thermaheat Lite)</strong>: para noches, playa y montaña. Sostiene el calor sin pesar, porque rebota los rayos infrarrojos que emite el cuerpo. Es el forro de los <strong>Ashes</strong> y el <strong>Color Block</strong>.</li>
</ul>
<p>Si el cortaviento lo vas a usar entre mayo y septiembre, busca el que tiene forro térmico.</p>
<h3>3. La capucha y los detalles que importan</h3>
<ul>
<li><strong>Capucha ajustable con ceñidor</strong>: no se lleva el viento ni te entra agua por la cabeza. Es la del <strong>Trail Traveler</strong> y el <strong>Vintage</strong>.</li>
<li><strong>Capucha con cordón y cuello alto</strong>: mejor para la lluvia de verdad. Los <strong>Spring Trend</strong> van así.</li>
<li><strong>Sin capucha</strong>: más liviano y se combina con un gorro. El <strong>Pistachio Beach</strong> va así.</li>
<li><strong>Bolsillos laterales e interiores</strong>: sin ellos, el cortaviento se pierde en la mochila.</li>
<li><strong>Cierre de cremallera con puños elásticos</strong>: para que no te entre el aire por las muñecas.</li>
</ul>
<p>Nuestros <a href="/collections/cortavientos">cortavientos impermeables</a> tienen de las dos variantes, así que puedes comparar modelo por modelo en la ficha de cada uno.</p>
<h3>4. El corte: holgado o al cuerpo</h3>
<p>La mayoría de nuestros cortavientos son de <strong>corte holgado</strong>, pensados para llevar encima de un polerón o de un fleece sin que apriete. Los que son <strong>crop</strong> cortan más arriba de la cintura: sirven para la primavera y el verano, cuando no llevas capas debajo. Elige según la época y lo que te pones abajo, no solo por cómo se ve.</p>
<h3>5. La talla</h3>
<p>Van de la XS a la XXL y son de corte holgado. Mide una prenda que te quede bien y compárala con la <a href="/pages/guia-de-tallas">guía de tallas</a>: es la forma más rápida de no equivocarse. Si entre dos tallas dudas, elige la más grande y abrígate con una polera debajo.</p>`,
  },
  {
    handle: "parka-o-cortaviento-impermeable",
    title: "Parka o cortaviento impermeable: cuál comprar",
    date: FECHAS["parka-o-cortaviento-impermeable"],
    tags: ["parkas", "cortavientos", "impermeable"],
    desc:
      "Parka impermeable o cortaviento: cuándo necesitas abrigo de verdad y cuándo basta con algo liviano. La decisión en 30 segundos, con la tela de cada uno.",
    body: `<h2>Parka o cortaviento impermeable: cuál comprar</h2>
<p>Si vas a comprar una sola prenda impermeable para el invierno, es <strong>parka</strong>: abriga, cubre hasta la rodilla y aguanta la lluvia. El <strong>cortaviento impermeable</strong> es para cuando llueve pero no hace tanto frío, o para llevar en la mochila todo el año.</p>
<p>No compiten por lo mismo: la parka gana en abrigo y largo, el cortaviento gana en peso y en lo versátil que es.</p>
<h3>La decisión en 30 segundos</h3>
<ul>
<li><strong>¿Hace menos de 10 °C o hay heladas?</strong> → parka.</li>
<li><strong>¿Llueve pero se puede caminar con un polerón debajo?</strong> → cortaviento impermeable.</li>
<li><strong>¿Vives en el sur, en la costa o en la cordillera?</strong> → parka, sin pensarlo.</li>
<li><strong>¿Necesitas guardar espacio en la mochila?</strong> → cortaviento.</li>
</ul>
<h3>Qué lleva cada una por dentro</h3>
<p>La <strong>parka</strong> va con exterior <strong>Taslan Rip</strong> 100% impermeable o poliamida con poliuretano, y un forro térmico de verdad: <strong>Thermaheat Lite</strong> o <strong>Thermafleece 300</strong> de 2 cm. Eso es lo que sostiene la temperatura. Es la que se usa encima de una polera sin nada más. Las tipo leñadora suman forro de chiporro y cierre con broches de acero inoxidable.</p>
<p>El <strong>cortaviento impermeable</strong> va con una sola capa: exterior rip stop o poliamida con poliuretano, malla interior o forro térmico fino según el modelo. Es más liviano, se dobla y se guarda. Los <strong>Spring Trend</strong> además están hechos con poliéster reciclado, por dentro y por fuera.</p>
<p>Para verlas por separado: <a href="/collections/parkas">nuestras parkas impermeables</a> y <a href="/collections/cortavientos">nuestros cortavientos impermeables</a>.</p>
<h3>Impermeable de verdad o solo repelente al agua</h3>
<p>Antes de decidir, fíjate en la ficha: hay prendas que <strong>repelen</strong> el agua y prendas que la <strong>bloquean</strong>. La diferencia no es de nombre, es de milímetros de columna de agua y de tipo de tela. Te lo explicamos con números en la <a href="/pages/impermeables">guía de prendas impermeables</a>.</p>
<h3>El viento es el otro enemigo</h3>
<p>La lluvia te moja y el viento te enfría. Por eso los dosAbrigos técnicos llevan lo mismo: <strong>Thermaheat Lite</strong> en el forro, una tela delgada con millones de puntos plateados que rebotan los rayos infrarrojos del cuerpo y devuelven el calor en vez de dejarlo pasar. El nivel de retención de calor es de un <strong>20% más</strong> que otras telas de forro. Y la capucha ajustable con ceñidor sella la parte de arriba, que es por donde más se escapa el aire.</p>
<h3>Un detalle que casi nadie pregunta</h3>
<p>Si la parka ya es impermeable y va con forro térmico, <strong>no necesitas un impermeable encima</strong>: eso solo te va a hacer sudar. La combinación que funciona es la inversa: <strong>polerón o fleece debajo, parka encima</strong>. Cuando la temperatura sube, te quitas la parka y sigues con el polerón puesto. Por eso todos nuestros parkas están pensados para usarse sobre otra prenda, no sobre la piel.</p>
<h3>Y si te da lo mismo, compra la parka</h3>
<p>La parka abriga más y dura más: aguanta el invierno entero, la lluvia y el barro. El cortaviento es más barato, sí, pero es la prenda que te va a faltar cuando el termómetro baje de 8 °C. Si el presupuesto te da para una sola, es <a href="/collections/parkas">la parka</a>.</p>
<h3>Y si te da para dos</h3>
<p>La combinación que más rinde en el día a día chileno es una <strong>parka impermeable</strong> para los días de frío y lluvia, y un <strong>cortaviento</strong> para los días de viento y garúa, que en Santiago son muchos más de los que uno cree. Con un <strong>polerón oversize</strong> debajo de cualquiera de los dos, pasas el invierno entero sin pasar frío.</p>
<p>Y si entre las dos hay una duda de talla, escríbenos al <a href="https://wa.me/56929773980">WhatsApp +56 9 2977 3980</a> y te ayudamos a elegir.</p>`,
  },
  {
    handle: "como-lavar-una-parka-impermeable",
    title: "Cómo lavar y cuidar una parka impermeable",
    date: FECHAS["como-lavar-una-parka-impermeable"],
    tags: ["cuidado", "parkas", "impermeable"],
    desc:
      "Lavar una parka impermeable sin arruinarla: agua fría, detergente líquido, nunca secadora y cómo cuidar el forro de chiporro o Thermafleece.",
    body: `<h2>Cómo lavar y cuidar una parka impermeable</h2>
<p>La parka impermeable se lava en la lavadora, pero con tres reglas: <strong>agua fría</strong>, <strong>detergente líquido</strong> y <strong>nunca secadora</strong>. Si respetas esos tres puntos, la tela sigue repeliendo el agua y el forro térmico no se aplasta ni se descose.</p>
<h3>Antes de meterla a la lavadora</h3>
<ul>
<li>Cierra todos los cierres, velcros y broches. Los dientes de la cremallera y los broches de acero rayan el tejido exterior y rompen las costuras.</li>
<li>Saca los cinturones y los forros de pelo sueltos, y cualquier accesorio que no vaya en la lavadora.</li>
<li>Da vuelta la prenda o lávala del revés, para que el exterior no sufra.</li>
</ul>
<h3>El lavado</h3>
<ul>
<li><strong>Agua fría, máximo 30 °C.</strong> El calor fijo el tinte y daña el recubrimiento que repele el agua.</li>
<li><strong>Ciclo suave</strong> para prendas delicadas, o ciclo normal si la etiqueta de tu modelo lo permite.</li>
<li><strong>Detergente líquido neutro o suave.</strong> Nunca en polvo: sus partículas abrasivas deterioran el recubrimiento. Sin suavizante, sin blanqueador.</li>
<li><strong>No mezcles</strong> colores claros con oscuros en el mismo lavado, y no laves con ropa que suelte color.</li>
</ul>
<h3>El secado (aquí se arruina la mitad)</h3>
<ul>
<li><strong>Nunca secadora.</strong> El calor directo destruye la membrana impermeable y el forro térmico queda aplastado, como una esponja.</li>
<li>Extiéndela <strong>en horizontal a la sombra</strong>, o cuélgala en un colgador en un lugar muy ventilado.</li>
<li><strong>Jamás al sol directo</strong> ni cerca de una fuente de calor: el sol apaga el tinte y encoge el tejido.</li>
<li>Si la etiqueta lo permite, planchado en seco a baja temperatura; nunca toques la cara exterior con plancha caliente.</li>
</ul>
<h3>El forro: chiporro y Thermafleece</h3>
<p>Las parkas tipo leñadora llevan <strong>forro de chiporro</strong> y las de fleece llevan <strong>Thermafleece 300</strong>. El chiporro no se lava en máquina: se recomienda lavar a mano el forro y dejarlo secar al aire, cepillándolo siempre en la misma dirección del pelo. El Thermafleece sí aguanta la lavadora, siempre que vaya en agua fría y sin secadora.</p>
<p>Dato real de nuestros modelos tipo leñadora: el <strong>color del forro de chiporro es referencial</strong>, es decir, el tono que ves en la foto no necesariamente es el que te llega. El exterior sí es el que eliges.</p>
<h3>Manchas y sal: el caso de la costa</h3>
<p>La sal y la tierra se fijan si las dejas secar. Si la parka se mojó con agua de mar o con barro, lávala en el acto, antes de que se sequen: con agua tibia y un poco de jabón de manos basta. Para manchas locales, frota con un paño húmedo con jabón neutro y después lava la prenda como corresponde. Nunca uses diluyente, alcohol ni lejía sobre la membrana.</p>
<h3>Guardarla bien</h3>
<p>Cuando termina la temporada, cuélgala en un placard ventilado y con la cremallera cerrada. No la guardes comprimida en una bolsa al vacío: el forro térmico necesita aire para volver a su forma. Si está mojada, déjala secar antes de guardarla, o le queda olor.</p>
<p>La <a href="/collections/parkas">guía de parkas impermeables</a> te muestra qué forro y qué exterior tiene cada modelo, y si tienes dudas sobre el lavado de una prenda en particular, escríbenos al <a href="https://wa.me/56929773980">WhatsApp +56 9 2977 3980</a>.</p>`,
  },
];

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

  const ja = await gql(`{ blog(id: "${BLOG}") { articles(first: 30) { nodes { id handle title publishedAt } } } }`);
  const yaExisten = new Map(ja.blog.articles.nodes.map((a) => [a.handle, a]));

  console.log("  fecha de publicacion: " + (HOY ? "HOY (prueba)" : "abril 2027"));
  ARTICULOS.forEach((a) => {
    const palabras = a.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ").length;
    const enlaces = (a.body.match(/href="/g) || []).length;
    console.log(`\n  ${a.handle}`);
    console.log(`      title: ${a.title}`);
    console.log(`      fecha: ${HOY ? "hoy" : a.date}`);
    console.log(`      palabras: ${palabras} | enlaces internos: ${enlaces} | meta desc: ${a.desc.length} car`);
    if (palabras < 500) console.log("      (!) pocas palabras");
    if (enlaces < 2) console.log("      (!) pocos enlaces internos");
    if (yaExisten.has(a.handle)) console.log("      (ya existe, se actualiza)");
  });

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar, o --aplicar --hoy para publicar hoy)");
    return;
  }

  let errores = 0;
  for (const a of ARTICULOS) {
    const existente = yaExisten.get(a.handle);
    const fecha = HOY ? new Date().toISOString() : a.date;
    const esFuturo = !HOY && new Date(fecha) > new Date();
    let id = existente ? existente.id : null;

    if (existente) {
      const r = await gql(
        `mutation($id: ID!, $a: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $a) {
            article { id handle title publishedAt isPublished }
            userErrors { message field }
          }
        }`,
        {
          id,
          a: {
            title: a.title,
            body: a.body,
            handle: a.handle,
            tags: a.tags,
            isPublished: !esFuturo,
            publishDate: fecha,
            author: { name: "MONDANO" },
          },
        }
      );
      const ue = r && r.articleUpdate ? r.articleUpdate.userErrors : null;
      if (!r || !r.articleUpdate) {
        console.log(`  ${a.handle}: ERROR la mutation no respondio`);
        errores++;
        continue;
      }
      if (ue && ue.length) {
        console.log(`  ${a.handle}: ERROR ${JSON.stringify(ue).slice(0, 220)}`);
        errores++;
        continue;
      }
      id = r.articleUpdate.article.id;
      console.log(`  ${a.handle}: actualizado (${id})`);
    } else {
      const r = await gql(
        `mutation($a: ArticleCreateInput!) {
          articleCreate(article: $a) {
            article { id handle title publishedAt isPublished }
            userErrors { message field }
          }
        }`,
        {
          a: {
            blogId: BLOG,
            title: a.title,
            body: a.body,
            handle: a.handle,
            tags: a.tags,
            isPublished: !esFuturo,
            publishDate: fecha,
            author: { name: "MONDANO" },
          },
        }
      );
      const ue = r && r.articleCreate ? r.articleCreate.userErrors : null;
      if (!r || !r.articleCreate) {
        console.log(`  ${a.handle}: ERROR la mutation no respondio`);
        errores++;
        continue;
      }
      if (ue && ue.length) {
        console.log(`  ${a.handle}: ERROR ${JSON.stringify(ue).slice(0, 220)}`);
        errores++;
        continue;
      }
      id = r.articleCreate.article.id;
      console.log(`  ${a.handle}: creado (${id})`);
    }

    const rm = await gql(
      `mutation($m: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $m) {
          metafields { namespace key value }
          userErrors { message field }
        }
      }`,
      {
        m: [
          {
            ownerId: id,
            namespace: "seo",
            key: "description",
            type: "single_line_text_field",
            value: a.desc,
          },
        ],
      }
    );
    const uem = rm && rm.metafieldsSet ? rm.metafieldsSet.userErrors : null;
    console.log(`      meta description: ${uem && uem.length ? "ERROR " + JSON.stringify(uem).slice(0, 160) : "OK"}`);
  }

  console.log(`\n  ${ARTICULOS.length} articulos | errores: ${errores}`);
})();
