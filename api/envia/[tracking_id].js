export default async function handler(req, res) {
  const { tracking_id } = req.query;
  const response = await fetch("https://api.envia.com/ship/generaltrack", {
    method: "POST",
    body: JSON.stringify({ trackingNumbers: [tracking_id] }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ENVIA_API_KEY}`,
    },
  });

  const data = await response.json();
  if (data.error) {
    res.status(500).json({ error: "No se encontró el número de seguimiento" });
  } else {
    res.status(200).json(data);
  }
}
