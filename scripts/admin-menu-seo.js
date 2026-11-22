/**
 * Actualiza el menu principal con las colecciones del plan SEO (22-12-2026).
 *
 *   node scripts/admin-menu-seo.js            -> dry-run
 *   node scripts/admin-menu-seo.js --aplicar   -> escribe
 *
 * Agrega bajo "Tienda": Parkas, Casacas e Impermeables (la pagina hub).
 * menuUpdate REEMPLAZA el menu completo, asi que se reenvian TODOS los items
 * con su id (los ids no se pueden recuperar despues).
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const MENU = "gid://shopify/Menu/194151743711";

// Orden de las colecciones dentro de "Tienda": primero las genericas
// (que son las que hoy no existen en Google), despues el resto.
const NUEVOS = [
  { title: "Parkas", type: "COLLECTION", handle: "parkas" },
  { title: "Casacas", type: "COLLECTION", handle: "casacas" },
  { title: "Impermeables", type: "HTTP", url: "/pages/impermeables" },
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
      console.log("   (!) " + JSON.stringify(r.errors).slice(0, 260));
      return null;
    }
    return r.data;
  };

  const jc = await gql(`{ collections(first: 40) { nodes { id title handle } } }`);
  const porHandle = new Map(jc.collections.nodes.map((c) => [c.handle, c.id]));
  const nuevos = NUEVOS.map((n) => {
    if (!n.handle) return { ...n };
    const id = porHandle.get(n.handle);
    if (!id) console.log("  ERROR: no se encontro la coleccion " + n.handle);
    return { title: n.title, type: n.type, resourceId: id, url: n.url };
  });
  if (nuevos.some((n) => n.type === "COLLECTION" && !n.resourceId)) return;

  const jm = await gql(`{
    menus(first: 10) {
      nodes { id title handle items { id title type url resourceId items { id title type url resourceId } } }
    }
  }`);
  const menu = jm.menus.nodes.find((m) => m.id === MENU);
  if (!menu) {
    console.log("  ERROR: no se encontro el menu principal");
    return;
  }

  // Se clonan los items con su id y se insertan los nuevos al principio de
  // "Tienda".
  const clonar = (items) =>
    items.map((i) => {
      const o = { id: i.id, title: i.title, type: i.type };
      if (i.url) o.url = i.url;
      if (i.resourceId) o.resourceId = i.resourceId;
      if (i.items && i.items.length) o.items = clonar(i.items);
      return o;
    });

  const items = clonar(menu.items);
  const tienda = items.find((i) => i.title === "Tienda");
  if (!tienda) {
    console.log("  ERROR: no se encontro el item 'Tienda'");
    return;
  }
  const sinNuevos = (tienda.items || []).filter((i) => !["Parkas", "Casacas", "Impermeables"].includes(i.title));
  tienda.items = [...nuevos.map((n) => ({ ...n })), ...sinNuevos];

  const mostrar = (its, n) =>
    its.forEach((i) => {
      console.log("  ".repeat(n) + "- " + i.title + " [" + i.type + "] " + (i.url || i.resourceId || ""));
      if (i.items) mostrar(i.items, n + 2);
    });
  console.log("\n  menu resultante:");
  mostrar(items, 1);

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  const r = await gql(
    `mutation($id: ID!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: "Menú principal", items: $items) {
        menu { id title }
        userErrors { message field }
      }
    }`,
    { id: MENU, items }
  );
  const ue = r && r.menuUpdate ? r.menuUpdate.userErrors : null;
  console.log("\n  menuUpdate: " + (ue && ue.length ? "ERROR " + JSON.stringify(ue).slice(0, 240) : "OK"));
})();
