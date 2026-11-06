/**
 * Agente de IA para respuestas automaticas de WhatsApp.
 *
 * Usa x.ai (API compatible con OpenAI) para responder preguntas de tracking
 * de pedidos. La IA recibe como contexto el estado real del envio (obtenido
 * de la API de Envia) y NO debe inventar datos.
 *
 * Reglas de negocio implementadas aqui:
 *  - La IA solo responde sobre datos que aparecen en el contexto entregado.
 *  - Si la IA no sabe, indica que va a escalar a un humano.
 *  - Se detecta la intencion de hablar con una persona y se escala de inmediato.
 */

const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai/v1";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.7";

/**
 * Palabras que indican que el cliente quiere hablar con una persona.
 * El regex es deliberadamente amplio: ante la duda, escalar es mejor que
 * responder mal.
 */
const HUMAN_INTENT_PATTERNS = [
  /\bhablar con (alguien|una persona|un humano|un asesor)\b/i,
  /\bhablar con (alguien|una persona|un humano|un asesor)\b/i,
  /\bcon un (humano|asesor|agente|operador)\b/i,
  /\bpersona (real|humana)\b/i,
  /\bhablar con (alguien|un agente)\b/i,
  /\bescalar\b/i,
  /\bqueja\b/i,
  /\breclamo\b/i,
  /\bproblema (con|grave)\b/i,
  /\bno (me )?(sirve|sirven|funciona)\b/i,
  /\bquiero (cancelar|devolver|reembolsar)\b/i,
  /\bhumano\b/i,
  /\bagente\b/i,
];

/**
 * Detecta si el mensaje pide intervención humana.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function wantsHuman(text) {
  if (!text) return false;
  return HUMAN_INTENT_PATTERNS.some((re) => re.test(text));
}

const SYSTEM_PROMPT = `Eres el asistente de WhatsApp de Mondano, una marca chilena de moda urbana.

Tu unica funcion es responder preguntas sobre el estado y la fecha de entrega de un pedido.

REGLAS ESTRICTAS:
1. Responde SOLO con informacion presente en el CONTEXTO DEL PEDIDO que se te entrega.
2. Si el contexto no contiene la respuesta, NO inventes ni estimes. Di que no tienes esa informacion y que un asesor te ayudara.
3. Se breve y friendly, como un chat. Usa "tú". Maximo 3 frases.
4. Si el pedido NO fue encontrado, pide el numero de pedido (formato MON-XXXX) y ofrece pasar con un asesor.
5. Si el cliente saluda sin pedir informacion, responde con un saludo corto y preguntale como puedes ayudarte.
6. Nunca prometas fechas que no esten en el contexto.
7. Nunca inventes politicas de la tienda (plazos de envio, costos, formas de pago) que no esten en el contexto.

FORMATO DE RESPUESTA: solo el texto que se envia por WhatsApp. Sin prefijo, sin comillas, sin markdown.`;

/**
 * Construye el contexto del pedido a partir de los datos de envio.
 *
 * @param {object} shipment Datos del envio y tracking.
 * @returns {string} Contexto en texto plano para el prompt.
 */
function buildShipmentContext(shipment) {
  if (!shipment) return "No se encontro ningun pedido asociado a este numero de telefono.";

  const lines = [];
  lines.push(`Numero de pedido: ${shipment.orderId || "desconocido"}`);
  if (shipment.trackingNumber) lines.push(`Numero de seguimiento: ${shipment.trackingNumber}`);
  if (shipment.carrier) lines.push(`Transportista: ${shipment.carrier}`);
  if (shipment.service) lines.push(`Servicio: ${shipment.service}`);

  if (shipment.events && shipment.events.length > 0) {
    lines.push("Ultimos eventos del envio:");
    for (const ev of shipment.events) {
      const when = ev.date ? ev.date : "";
      const where = ev.city ? ` en ${ev.city}` : "";
      lines.push(`- ${when}${where}: ${ev.description || ev.status || ""}`);
    }
  }

  if (shipment.estimatedDelivery) {
    lines.push(`Fecha estimada de entrega: ${shipment.estimatedDelivery}`);
  }
  if (shipment.currentStatus) {
    lines.push(`Estado actual: ${shipment.currentStatus}`);
  }
  if (shipment.delivered) {
    lines.push("El pedido fue entregado.");
  }

  return lines.join("\n");
}

/**
 * Genera la respuesta del agente con x.ai.
 *
 * @param {object} params
 * @param {string} params.userText Mensaje del cliente.
 * @param {string} params.context Contexto del pedido.
 * @param {string} [params.apiKey] Clave de x.ai.
 * @param {string} [params.model] Modelo a usar.
 * @returns {Promise<{ok: boolean, reply: string, error?: string}>}
 */
async function generateReply({ userText, context, apiKey, model }) {
  const key = apiKey || process.env.XAI_API_KEY;
  const modelId = model || XAI_MODEL;

  if (!key) {
    return { ok: false, reply: "", error: "Falta XAI_API_KEY" };
  }

  const prompt = `CONTEXTO DEL PEDIDO:\n${context || "(sin contexto)"}\n\n---\nMENSAJE DEL CLIENTE:\n${userText}`;

  try {
    const response = await fetch(`${XAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        store: false,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = data?.error?.message || `HTTP ${response.status}`;
      return { ok: false, reply: "", error: detail };
    }

    // La Responses API devuelve output_text o el array output con items de tipo message.
    let text = "";
    if (typeof data.output_text === "string" && data.output_text) {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) text += part.text;
          }
        }
      }
    }

    if (!text) {
      return { ok: false, reply: "", error: "La IA no devolvio texto" };
    }

    return { ok: true, reply: text.trim() };
  } catch (error) {
    return { ok: false, reply: "", error: error.message };
  }
}

module.exports = {
  XAI_MODEL,
  SYSTEM_PROMPT,
  wantsHuman,
  buildShipmentContext,
  generateReply,
};
