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
// grok-4.7 es un modelo de RAZONAMIENTO: con el prompt real de produccion
// tardaba 20-24 s, justo contra el timeout, y fallaba de forma intermitente.
// Los modelos "non-reasoning" responden lo mismo en ~1,3 s.
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.20-non-reasoning";

/**
 * Palabras que indican que el cliente pide intervencion humana.
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

/**
 * Normaliza texto para compararlo: minusculas y sin acentos.
 *
 * Asi los patrones no tienen que duplicar cada palabra con y sin tilde.
 *
 * @param {string} text Texto.
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Palabras que indican que el cliente YA RECIBIO el pedido.
 *
 * OJO: estos patrones se comparan contra el texto NORMALIZADO (minusculas y
 * sin acentos), asi que van sin tilde: "recibí" -> "recibi", "llegó" -> "llego".
 *
 * Cuando el cliente dice que ya llego, el bot NO debe seguir preguntando el
 * numero de pedido: el cliente ya dijo que lo recibio, pedirle el numero
 * es absurdo. Se detecta aparte para no confundirse con "aun no me llega".
 */
const ALREADY_ARRIVED_PATTERNS = [
  /\b(recien |ya )(me |lo |la |les )?(llego|esta aqui|lo tengo|tengo el|tengo la|recibi|esta en mi casa|esta en casa)\b/,
  /\b(me |lo |la |nos )?llego (bien|todo|el pedido|la prenda|el paquete|el producto|la ropa|la caja|tarde|rapido|ayer|hoy)\b/,
  /\bme llego\b/,
  /\blo (recibi|tengo)\b/,
  /\brecibi (el |la |mi |todo|toda)\b/,
  /\bya lo (tengo|recibi)\b/,
  /\bme lo trajeron\b/,
  /\bya esta en (mi |la )?(casa|domicilio)\b/,
  /\bentregado\b/,
];

/**
 * Señales de que el pedido AUN NO llego. Si aparece alguna, el cliente NO
 * esta diciendo que ya lo recibio (esta preguntando, no afirmando).
 */
const NOT_YET_ARRIVED_PATTERNS = [
  /\b(aun|todavia)\b/,
  /\bno (me |ha |he |nos )*(llegado|llegue|llega|recibido|recibi|tenido|traido)\b/,
  /\bno (esta|estan) entregad/,
  /\bfalta\b/,
  /\bno ha llegado\b/,
  /\bsigue (sin llegar|en camino)\b/,
  // "cuando ya llegue me avisas" es futuro, no "ya llego".
  /\bcuando\b[^.?!]{0,25}\bllegue\b/,
  /\bsi (ya )?llega\b/,
  /\bcuando me (lo )?envien\b/,
];

/**
 * Detecta si el cliente afirma que su pedido ya llego.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function saysAlreadyArrived(text) {
  if (!text) return false;
  const t = normalizeText(text);
  if (NOT_YET_ARRIVED_PATTERNS.some((re) => re.test(t))) return false;
  return ALREADY_ARRIVED_PATTERNS.some((re) => re.test(t));
}

/**
 * Palabras que indican que el cliente pregunta por el estado de un pedido.
 *
 * OJO: se comparan contra el texto NORMALIZADO (minusculas y sin acentos),
 * asi que van sin tilde: "recibí" -> "recibi", "pasó" -> "paso".
 */
const TRACKING_INTENT_PATTERNS = [
  /\bmi (pedido|orden|compra|envio|entrega|paquete)\b/,
  /\b(pedido|orden|compra)\b/,
  /\b(mi|del|de mi|de el|ultimo|ultima) (envio|entrega|paquete)\b/,
  /\b(donde|cuando|que|cuanto|cuantos) (me )?(esta|llega|llegara|llego|llegue|pasó)\b/,
  /\b(donde|cuando|que|cuanto|cuantos)\b[^.?!]{0,25}\b(llega|llego|envian|llegue|llegamos|demora|plazo)\b/,
  /\bya (esta|llego|recibi)\b/,
  /\bque paso con mi\b/,
  /\b(llego|recibi|me llego)\b/,
  /\b(seguimiento|tracking|rastreo)\b/,
  /\bnumero de (pedido|seguimiento)\b/,
  /\bestado\b/,
  /\b(aun no|todavia no) me (llega|llego)\b/,
  /\bno (me |ha |he |nos )*(llegado|llegue|llega|recibido|recibi)\b/,
  /\bno he recibido\b/,
  /\brecibi\b/,
];

/**
 * Saludo puro: no contiene ninguna peticion.
 */
const GREETING_ONLY_PATTERNS = [
  /^\s*(hola|holi|holis|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello|que tal|que onda|saludos)\b[\s!.,¿?]*$/i,
];

/**
 * Detecta si el mensaje pregunta por el estado de un pedido.
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function isTrackingIntent(text) {
  if (!text) return false;
  const t = normalizeText(text);
  return TRACKING_INTENT_PATTERNS.some((re) => re.test(t));
}

/**
 * Detecta si el mensaje es solo un saludo (sin peticion).
 *
 * @param {string} text Texto del cliente.
 * @returns {boolean}
 */
function isGreetingOnly(text) {
  if (!text) return false;
  return GREETING_ONLY_PATTERNS.some((re) => re.test(text));
}

/**
 * Contexto para cuando NO se pudo identificar el pedido.
 *
 * Distingue entre "no lo buscamos" y "lo buscamos y no existe", porque la
 * respuesta al cliente es muy distinta en cada caso.
 *
 * @param {object} params
 * @param {string} [params.reason] Motivo por el que no se pudo resolver.
 * @param {string} [params.orderId] Pedido que dio el cliente.
 * @param {number} [params.matches] Cuantos envios coinciden con el telefono.
 * @param {string} [params.channel] 'instagram' | 'whatsapp'
 * @param {boolean} [params.greeting] El mensaje fue solo un saludo.
 * @returns {string}
 */
function buildMissingDataContext({ reason, orderId, matches, channel, greeting } = {}) {
  const lines = [];

  if (greeting) {
    lines.push(
      `El cliente solo saluda. Saluda de vuelta y PIDE DIRECTAMENTE el dato ` +
        `que falta (no preguntes "en que puedo ayudarte" sin decir que ` +
        `datos necesitas).`
    );
  }

  switch (reason) {
    case "pedido_desconocido":
      lines.push(
        `Se busca el pedido ${orderId} pero NO existe en la base de datos. ` +
          `Pide al cliente que revise el numero de pedido (formato MON3007).`
      );
      break;

    case "pedido_no_encontrado":
      lines.push(
        `No se tiene informacion del pedido ${orderId}. Puede que el numero ` +
          `este mal escrito, o que todavia no tenga etiqueta de envio. ` +
          `NO le digas al cliente que el pedido no existe. Pide que confirme ` +
          `el numero (formato MON3007) y ofrece pasar con un asesor.`
      );
      break;

    case "sin_verificar":
      lines.push(
        `No se pudo verificar el envio del pedido ${orderId} en este momento ` +
          `por un problema tecnico. NO le digas al cliente que el pedido no ` +
          `existe ni que no tiene envio. Dile que no pudimos verificar el ` +
          `estado ahora y ofrece pasar con un asesor.`
      );
      break;

    case "pedido_sin_envio":
      lines.push(
        `El pedido ${orderId} existe pero no tiene envio generado todavia.`
      );
      break;

    default:
      lines.push(
        `Todavia NO se ha identificado ningun pedido del cliente. ` +
          `No se ha buscado nada todavia: falta un dato.`
      );
      break;
  }

  // El unico dato que se pide es el numero de pedido.
  lines.push(`Pide el numero de pedido (formato MON3007).`);

  return lines.join("\n");
}

/**
 * Contexto para cuando el cliente dice que su pedido YA LLEGO.
 *
 * Es el caso en el que el bot NO debe pedir el numero de pedido: el cliente
 * ya dijo que lo recibio. Pedirselo ahi es absurdo y el cliente lo percibe
 * como que el bot no lo escucho.
 *
 * @param {object} [params]
 * @param {string} [params.orderId] Pedido que se pudo identificar (si hubo).
 * @returns {string}
 */
function buildAlreadyArrivedContext({ orderId } = {}) {
  const lines = [];

  lines.push(
    `El cliente dice que su pedido YA LLEGO (o que ya lo recibio).`
  );
  if (orderId) {
    lines.push(`El pedido en referencia es el ${orderId}.`);
  }

  lines.push(
    `NO le pidas el numero de pedido: el cliente ya dijo que lo recibio, ` +
      `pedirselo es absurdo y parece que no lo escuchaste.`
  );
  lines.push(
    `Responde en una o dos frases: alegra que haya llegado y pregunta en que ` +
      `puedogles ayudar (cambio de talla o color, garantia, devolucion) o ` +
      `ofrece pasar con un asesor si necesita algo.`
  );
  lines.push(
    `NO le digas que su pedido sigue en camino ni le des el estado de un envio ` +
      `que el cliente ya dio por recibido.`
  );

  return lines.join("\n");
}

/**
 * Contexto con las notas internas del pedido (notas de Shopify).
 *
 * Estas notas son informacion interna del taller. Se le dan al modelo para
 * que las traduzca a un mensaje para el cliente, nunca para copiarlas.
 *
 * Hay dos casos:
 *   - Las notas describen etapas o personalizaciones (agregar gorro, cambiar
 *     color, corregir talla): se le pide que las cuente.
 *   - No hay nada util: solo se dice que el pedido esta en confeccion.
 *
 * @param {string} notes Notas internas relevantes (puede ir vacio).
 * @param {object} [options] { processDetails } las notas traen etapas.
 * @returns {string}
 */
function buildProcessContext(notes, { processDetails = false } = {}) {
  if (!notes) {
    return (
      `El pedido sigue en el taller, en CONFECCION: todavia no se ha entregado ` +
      `a la transportista. NO hay detalle de etapas ni indicaciones especiales ` +
      `en las notas internas, asi que NO inventes ninguna. Dile simplemente que ` +
      `el pedido esta en confeccion.`
    );
  }

  const extra =
    processDetails
      ? `en que etapa va la fabricacion (corte, elaboracion, planchado, ` +
        `ensamblaje, etc.), tal como aparece en las notas.`
      : `que indicaciones especiales le estamos aplicando al pedido (por ` +
        `ejemplo, que le estamos agregando el gorro, o el color o la talla), ` +
        `tal como aparece en las notas.`;

  return (
    `NOTAS INTERNAS DEL PEDIDO (no son del cliente):\n` +
    `${notes}\n\n` +
    `El cliente pregunto por su pedido. El pedido sigue en el taller, en ` +
    `CONFECCION: todavia no se ha entregado a la transportista. ` +
    `Cuentasele de forma breve y amigable ` +
    extra +
    ` Si las notas no aportan nada util, dile solo que esta en confeccion. ` +
    `NO menciones referencias internas (numeros de ticket, otros pedidos, ` +
    `notas de logistica o de conserjeria) ni datos que no esten en las notas.`
  );
}

const SYSTEM_PROMPT = `Eres el asistente de WhatsApp de Mondano, una marca chilena de moda urbana.

Tu unica funcion es responder preguntas sobre el estado y la fecha de entrega de un pedido.

REGLAS ESTRICTAS:
1. Responde SOLO con informacion presente en el CONTEXTO DEL PEDIDO que se te entrega.
2. Si el contexto no contiene la respuesta, NO inventes ni estimes. Di que no tienes esa informacion y que un asesor te ayudara.
3. Se breve y friendly, como un chat. Usa "tú". Maximo 3 frases.
4. Si el pedido NO fue encontrado, pide el numero de pedido (formato MON3007) y ofrece pasar con un asesor.
5. Si el cliente saluda sin pedir informacion: si el CONTEXTO ya identifica un pedido concreto, saluda y dale el estado de ese pedido; si no hay pedido identificado, responde con un saludo corto y preguntale como puedes ayudarle.
6. Nunca prometas fechas que no esten en el contexto.
7. Nunca inventes politicas de la tienda (plazos de envio, costos, formas de pago) que no esten en el contexto.
8. Cuando el contexto indique que falta un dato para identificar el pedido, pide SOLO el numero de pedido (formato MON3007). Nunca pidas el telefono del cliente ni el email.
9. Escribe el numero de pedido tal cual, sin guion y sin almohadilla: MON3007. Nunca MON-3007 ni #MON3007.
10. Si el CONTEXTO incluye NOTAS INTERNAS DEL PEDIDO, mencionalas en el mismo mensaje, junto al estado del envio. Maximo 2 frases extra.

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
  if (shipment.currentStatus || shipment.status) {
    lines.push(`Estado actual: ${shipment.currentStatus || shipment.status}`);
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

  if (!key || key === "PENDIENTE" || !key.trim()) {
    return { ok: false, reply: "", error: "XAI_API_KEY no configurado (placeholder o vacio)" };
  }

  const prompt = `CONTEXTO DEL PEDIDO:\n${context || "(sin contexto)"}\n\n---\nMENSAJE DEL CLIENTE:\n${userText}`;

  // Timeout: sin esto, una llamada lenta a x.ai puede dejar la funcion de
  // Vercel colgada hasta que la matan por exceeding maxDuration.
  const timeoutMs = Number(process.env.XAI_TIMEOUT_MS || 12000);
  // Un reintento como red de seguridad: solo ante timeout o error de red,
  // nunca ante un error de la API (un 400 no se arregla reintentando).
  const maxAttempts = Number(process.env.XAI_MAX_ATTEMPTS || 2);
  const backoffMs = Number(process.env.XAI_RETRY_BACKOFF_MS || 800);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        signal: AbortSignal.timeout(timeoutMs),
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
      const reintentable = error?.name === "TimeoutError" || error?.name === "AbortError" || /timeout|aborted|fetch failed|ECONN/i.test(error?.message || "");
      if (attempt < maxAttempts && reintentable) {
        console.warn(
          `[ai] x.ai fallo (${error.message}) -> reintento ${attempt}/${maxAttempts - 1} en ${backoffMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      return { ok: false, reply: "", error: error.message };
    }
  }

  return { ok: false, reply: "", error: "x.ai: sin intentos disponibles" };
}

module.exports = {
  XAI_MODEL,
  SYSTEM_PROMPT,
  wantsHuman,
  isTrackingIntent,
  isGreetingOnly,
  saysAlreadyArrived,
  buildShipmentContext,
  buildProcessContext,
  buildMissingDataContext,
  buildAlreadyArrivedContext,
  generateReply,
};
