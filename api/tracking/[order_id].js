import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { order_id } = req.query;
  const { data, error } = await supabase.from("order_tracking").select("tracking_id").eq("order_id", order_id);

  if (error) {
    res.status(500).json({ error: "No se encontró el número de seguimiento" });
  } else {
    res.status(200).json(data);
  }
}
