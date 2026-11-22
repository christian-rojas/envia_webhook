/**
 * Codigo de descuento para la campana de resenas, en version NATIVA de
 * Shopify (gratis), para reemplazar el cupon que genera Judge.me (que exige el
 * plan Awesome de USD 15).
 *
 *   node scripts/admin-codigo-resena.js            -> dry-run
 *   node scripts/admin-codigo-resena.js --aplicar   -> crea el codigo
 *
 * OJO: la app custom de la tienda (SHOPIFY_ADMIN_*) tiene 15 scopes y NO
 * tiene write_discounts, asi que este script devuelve "Access denied" hasta
 * que se agregue ese scope en el Partner Dashboard:
 *   Shopify -> Apps -> Mondano -> Configuration -> API -> Permisos de acceso
 * Mientras tanto, el codigo se crea a mano en el admin (6 clics), con los
 * mismos valores de CODIGO que estan mas abajo.
 *
 * Por que este codigo:
 *   - Judge.me Email (gratis, 15.000 emails/mes) tiene un bloque "Discount"
 *     en los flows que permite elegir un codigo de Shopify existente.
 *   - Judge.me settings ya tiene "uses_external_coupon": false, asi que la
 *     app esta preparada para trabajar con un codigo externo.
 *
 * Reglas del codigo:
 *   - 10% de descuento (el mismo valor que estaba configurado en Judge.me:
 *     coupon_value_percentage: 10)
 *   - "una vez por cliente": si el codigo se filtra, no se puede reutilizar
 *     en la misma cuenta. Es el equivalente al "can only be used once by each
 *     customer" de los cupones de Judge.me.
 *   - No se acumula con otros descuentos de pedido (para no encadenar 20%).
 *   - Sin fecha de expiracion: el codigo vive mientras viva la campana de
 *     resenas. Si el merchant quiere acotarlo, se le pone endsAt.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");

const CODIGO = {
  title: "Reseña MONDANO 10%",
  code: "RESENA10",
  percentage: 0.1,
  appliesOncePerCustomer: true,
  usageLimit: null,
  endsAt: null,
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

  // descuentos que ya existen
  const jd = await gql(`{
    discountNodes(first: 40) {
      nodes {
        id
        discount {
          ... on DiscountCodeBasic {
            title
            summary
            startsAt
            endsAt
            usageLimit
            appliesOncePerCustomer
            codes(first: 3) { nodes { code } }
          }
        }
      }
    }
  }`);
  console.log("  descuentos actuales en la tienda:");
  (jd.discountNodes.nodes || []).forEach((d) => {
    const b = d.discount || {};
    const codes = b.codes ? b.codes.nodes.map((c) => c.code).join(", ") : "?";
    console.log(
      "    " + String(codes).padEnd(26) + " | " + String(b.title || "?").padEnd(28) +
      (b.appliesOncePerCustomer ? " | una vez por cliente" : "")
    );
  });

  const jex = await gql(`{
    codeDiscountNodeByCode(code: "${CODIGO.code}") {
      id
      discount { ... on DiscountCodeBasic { title summary codesCount { count } } }
    }
  }`);
  if (jex && jex.codeDiscountNodeByCode) {
    console.log(`\n  el codigo ${CODIGO.code} ya existe (${jex.codeDiscountNodeByCode.id}). No se toca.`);
    return;
  }

  console.log("\n  a crear:");
  console.log("    titulo:   " + CODIGO.title);
  console.log("    codigo:   " + CODIGO.code);
  console.log("    valor:    " + CODIGO.percentage * 100 + "% de descuento en todos los productos");
  console.log("    regla:    una vez por cliente, no se acumula con descuentos de pedido");

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  const r = await gql(
    `mutation($d: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $d) {
        codeDiscountNode {
          id
          discount { ... on DiscountCodeBasic { title summary startsAt endsAt usageLimit appliesOncePerCustomer codesCount { count } codes(first: 3) { nodes { code } } } }
        }
        userErrors { message field }
      }
    }`,
    {
      d: {
        title: CODIGO.title,
        code: CODIGO.code,
        startsAt: new Date().toISOString(),
        endsAt: CODIGO.endsAt,
        appliesOncePerCustomer: CODIGO.appliesOncePerCustomer,
        usageLimit: CODIGO.usageLimit,
        customerGets: {
          value: { percentage: CODIGO.percentage },
          items: { all: true },
        },
        minimumRequirement: {},
        context: { all: "ALL" },
        combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
      },
    }
  );
  if (!r || !r.discountCodeBasicCreate) {
    console.log("  ERROR: la mutation no respondio");
    return;
  }
  const ue = r.discountCodeBasicCreate.userErrors;
  if (ue && ue.length) {
    console.log("  ERROR " + JSON.stringify(ue).slice(0, 300));
    return;
  }
  const n = r.discountCodeBasicCreate.codeDiscountNode;
  const b = n.discount;
  console.log("\n  creado: " + b.codes.nodes.map((c) => c.code).join(", ") + " (" + n.id + ")");
  console.log("  titulo: " + b.title);
  console.log("  una vez por cliente: " + b.appliesOncePerCustomer);
})();
