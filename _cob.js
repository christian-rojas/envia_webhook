require("dotenv").config();
(async () => {
  const SHOP = process.env.SHOPIFY_SHOP;
  const t = await (await fetch("https://" + SHOP + ".myshopify.com/admin/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
  })).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = "https://" + SHOP + ".myshopify.com/admin/api/2026-01/graphql.json";
  const gql = async (q) => {
    const r = await (await fetch(A, { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json();
    if (r.errors) { console.log("  err " + JSON.stringify(r.errors).slice(0, 200)); return null; }
    return r.data;
  };
  const ps = [];
  let after = null;
  for (let i = 0; i < 4; i++) {
    const q = '{ products(first: 40' + (after ? ', after: "' + after + '"' : "") + ', query: "status:active") { nodes { title handle collections(first: 20) { nodes { handle } } } pageInfo { hasNextPage endCursor } } }';
    const r = await gql(q);
    if (!r || !r.products) break;
    ps.push(...r.products.nodes);
    if (!r.products.pageInfo.hasNextPage) break;
    after = r.products.pageInfo.endCursor;
  }
  const sinCol = ps.filter((p) => p.collections.nodes.length === 0);
  console.log("  productos activos: " + ps.length + " | sin ninguna coleccion: " + sinCol.length);
  sinCol.forEach((p) => console.log("    - " + p.title + " (" + p.handle + ")"));
  const porCol = {};
  ps.forEach((p) => p.collections.nodes.forEach((c) => { porCol[c.handle] = (porCol[c.handle] || 0) + 1; }));
  console.log("\n  productos por coleccion:");
  Object.entries(porCol).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("    " + k.padEnd(24) + v));
})();
