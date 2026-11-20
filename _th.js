require("dotenv").config();
(async () => {
  const SHOP = process.env.SHOPIFY_SHOP;
  const t = await (await fetch("https://" + SHOP + ".myshopify.com/admin/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: process.env.SHOPIFY_ADMIN_CLIENT_SECRET, grant_type: "client_credentials" }),
  })).json();
  const H = { "X-Shopify-Access-Token": t.access_token, "Content-Type": "application/json" };
  const A = "https://" + SHOP + ".myshopify.com/admin/api/2026-01";
  const r = await (await fetch(A + "/themes.json", { headers: H })).json();
  const candidatos = ["187221082335", "186870825183", "186871021791", "186871218399", "187221704927"];
  r.themes.filter((x) => candidatos.includes(String(x.id))).forEach((x) => {
    console.log("  #" + x.id + "  " + x.name + "  role=" + x.role + "  updated=" + x.updated_at + "  files=" + (x.files ? x.files.length : 0));
  });
})();
