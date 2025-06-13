import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

function validateShopifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  const calculatedHmac = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(calculatedHmac));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // You may need to handle raw body parsing for HMAC validation
  // See Vercel docs for raw body: https://vercel.com/docs/functions/node#body-parsing

  if (!validateShopifyHmac(req)) {
    return res.status(401).json({ error: "Invalid HMAC" });
  }

  // ...rest of your logic (formatEnviaShipment, createEnviaShipment, etc.)
  // Remember to adapt any Express-specific code to plain Node.js/Fetch APIs
  res.status(200).json({ message: "Webhook received" });
}
