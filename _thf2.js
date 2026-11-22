require("dotenv").config();
(async () => {
  const SHOP = process.env.SHOPIFY_SHOP;
  const t = await (await fetch("https://" + SHOP + ".myshopify.com/admin/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
  })).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = "https://" + SHOP + ".myshopify.com/admin/api/2026-01";
  const r = await (await fetch(A + "/themes/187221082335/files.json", { headers: H })).json();
  console.log("  respuesta cruda:", JSON.stringify(r).slice(0, 300));
  const files = r.files || (r.file && [r.file]) || [];
  console.log("  archivos:", files.length);
  files.slice(0, 8).forEach((f) => console.log("    " + f.filename + " (" + f.size + ")"));
  const visor = files.find((f) => f.filename === "sections/visor-tallas.liquid");
  console.log("  visor-tallas remoto:", visor ? visor.size + " bytes" : "NO ESTA EN LA LISTA");
})();
