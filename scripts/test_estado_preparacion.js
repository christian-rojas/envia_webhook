/**
 * Test del fix de "estado de preparacion del pedido".
 *
 * MON4720 -> Shopify dice "Preparado"  => el bot NO debe decir "en confeccion"
 * MON4706 -> Shopify dice "No preparado" => el bot debe decir "en confeccion"
 */
const path = "/Users/christianrojas/Desktop/projects/envia_webhook";
require(`${path}/node_modules/dotenv`).config();
const index = require(`${path}/index.js`);

(async () => {
  const casos = [
    { texto: "donde esta mi pedido MON4720", preparado: true },
    { texto: "mi pedido donde esta MON4706", preparado: false },
  ];

  let fallos = 0;
  for (const c of casos) {
    const enviados = [];
    const sender = async (to, body) => {
      enviados.push(body);
      return { ok: true };
    };
    await index.handleInstagramMessage({ text: c.texto, customerId: "999" }, sender);
    const reply = enviados[0] || "(sin respuesta)";

    const diceEnConfeccion = /en\s+confecci[oó]n|sigue en el taller|en el taller/i.test(reply);
    const dicePreparado = /preparado|listo|ya tiene (su )?etiqueta/i.test(reply);

    console.log(`\n=== ${c.texto}  (Shopify: ${c.preparado ? "Preparado" : "No preparado"}) ===`);
    console.log(`  bot: ${reply.replace(/\s+/g, " ")}`);

    if (c.preparado) {
      const ok = !diceEnConfeccion && dicePreparado;
      console.log(`  ${ok ? "OK  " : "FALLA"} no dice "en confeccion" y si dice preparado`);
      if (!ok) fallos++;
    } else {
      const ok = diceEnConfeccion;
      console.log(`  ${ok ? "OK  " : "FALLA"} dice "en confeccion"`);
      if (!ok) fallos++;
    }
  }
  console.log(`\n=== RESULTADO: ${fallos === 0 ? "TODO OK" : fallos + " FALLOS"} ===`);
  process.exit(fallos === 0 ? 0 : 1);
})();
