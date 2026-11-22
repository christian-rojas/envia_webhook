/**
 * Campana de resenas por email, automatizada con la API de Klaviyo (22-12-2026).
 *
 *   node scripts/admin-klaviyo-resena.js            -> dry-run
 *   node scripts/admin-klaviyo-resena.js --aplicar   -> crea/actualiza y publica
 *
 * Que hace:
 *   1. Crea la plantilla del email (editor CODE, HTML con estilos inline).
 *   2. Le pone asunto y preheader reales al flow-message.
 *   3. Define el flow: trigger "Placed Order" de Shopify + espera de 8 dias
 *      + envio del email.
 *   4. Publica el flow.
 *
 * Deuda:
 *   - El codigo RESENA10 se crea en Shopify a mano (6 clics). Ver
 *     scripts/admin-codigo-resena.js: la app custom no tiene el scope
 *     write_discounts.
 *   - La plantilla se creo con editor CODE, asi que no se puede editar el
 *     texto desde el editor visual de Klaviyo sin perder los estilos. Para
 *     cambiar un texto, se edita el html en este script y se vuelve a correr.
 */
require("dotenv").config();

const APLICAR = process.argv.includes("--aplicar");
const KEY = process.env.KLAVIYO_PRIVATE_KEY;
const REVISION = "2025-04-15";

const NOMBRE_FLOW = "Escribe tu reseña";
const NOMBRE_TEMPLATE = "Post-compra: pedir reseña (MONDANO)";
// XZYuJK es el "Placed Order" NATIVO de la integracion de Shopify (creado a las
// 17:56:50 junto a las demas metricas). WiTRBu es un duplicado creado a mano
// 4 minutos despues, que no recibe los eventos de Shopify.
const METRICA_PLACED_ORDER = "XZYuJK";
const DIAS_DE_ESPERA = 8;
const FLOW_QUE_SE_MANTIENE = null; // id del flow a conservar (null = crear nuevo)
const CODIGO = "RESENA10";

const ASUNTO = "Tu MONDANO ya llegó: nos dices qué te gustó?";
const PREHEADER =
  "Cuéntanos qué te pareció tu prenda. Si nos dejas una reseña, te damos un 10% para tu próxima compra.";

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ASUNTO}</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ee;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:#111111;padding:24px 32px;">
    <div style="color:#ffffff;font-size:19px;letter-spacing:7px;font-weight:700;line-height:1;">MONDANO</div>
  </td></tr>

  <tr><td style="padding:34px 32px 0 32px;">
    <h1 style="margin:0 0 20px 0;font-size:22px;line-height:1.35;color:#111111;font-weight:700;">Tu MONDANO ya llegó: nos dices qué te gustó?</h1>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#333333;">Hola {{ first_name|default:"quien lee" }}:</p>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#333333;">Tu pedido ya está en tus manos. Si te llegó bien y te encantó, nos ayudaría mucho que nos dejaras una reseña: es lo que aparece en la ficha de la prenda y nos sirve para elegir bien los modelos del próximo invierno.</p>
    <p style="margin:0 0 26px 0;font-size:15px;line-height:1.65;color:#333333;">Cuéntanos qué te pareció <strong>{{ event.Items.0.ProductName }}</strong>:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px 0;">
      <tr><td style="background:#111111;border-radius:6px;">
        <a href="{{ event.Items.0.ProductURL }}#judgeme_product_reviews" style="display:inline-block;padding:15px 30px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Escribir mi reseña</a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px 0;font-size:13px;line-height:1.55;color:#777777;">Si tu pedido tenía más de una prenda, escríbenos y te mandamos el link de cada una para que las reseñes.</p>
    <p style="margin:0 0 8px 0;font-size:13px;line-height:1.55;color:#777777;">¿El botón no te llevó? Entra a <a href="https://mondano.cl" style="color:#777777;">mondano.cl</a>, busca tu prenda y deja la reseña en su ficha.</p>
  </td></tr>

  <tr><td style="padding:6px 32px 0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f4;border-radius:8px;">
      <tr><td style="padding:22px 24px;">
        <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#111111;font-weight:700;">Y para compensar la pena: 10% en tu próxima compra</p>
        <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#555555;">Cuando publiques tu reseña te mandamos un cupón de 10% de descuento para tu próxima compra en mondano.cl.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px dashed #111111;border-radius:6px;">
          <tr><td style="padding:11px 18px;font-size:18px;letter-spacing:2px;font-weight:700;color:#111111;font-family:'Courier New',Courier,monospace;">${CODIGO}</td></tr>
        </table>
        <p style="margin:12px 0 0 0;font-size:12px;line-height:1.5;color:#888888;">Un uso por cliente.</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:26px 32px 0 32px;">
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#333333;">Si algo no salió como esperabas, escríbenos y lo resolvemos: WhatsApp al <strong style="color:#111111;">+56 9 2977 3980</strong> o correo a <a href="mailto:contacto@mondano.cl" style="color:#111111;">contacto@mondano.cl</a>. También puedes revisar nuestra <a href="https://mondano.cl/pages/politica-de-cambio-y-devoluciones-1" style="color:#111111;">política de cambios y devoluciones</a>.</p>
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#333333;">Gracias por confiar en MONDANO.</p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#333333;">El equipo de MONDANO</p>
  </td></tr>

  <tr><td style="padding:30px 32px 34px 32px;">
    <div style="border-top:1px solid #e5e4e1;padding-top:18px;">
      <p style="margin:0;font-size:11px;line-height:1.6;color:#999999;">MONDANO · Santiago de Chile · mondano.cl</p>
      <p style="margin:6px 0 0 0;font-size:11px;line-height:1.6;color:#999999;"><a href="https://mondano.cl/pages/politica-de-cambio-y-devoluciones-1" style="color:#999999;">Cambios y devoluciones</a> · <a href="{{ unsubscribe_url }}" style="color:#999999;">No quieres recibir estos correos</a></p>
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const H = () => ({
  Authorization: "Klaviyo-API-Key " + KEY,
  accept: "application/json",
  "content-type": "application/vnd.api+json",
  revision: REVISION,
});

(async () => {
  if (!KEY) {
    console.log("  ERROR: falta KLAVIYO_PRIVATE_KEY en el .env");
    return;
  }
  const call = async (method, path, body) => {
    const r = await fetch("https://a.klaviyo.com/api" + path, {
      method,
      headers: H(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch (e) {
      j = t;
    }
    return { status: r.status, j };
  };

  console.log("  flow: " + NOMBRE_FLOW + " | metric: " + METRICA_PLACED_ORDER + " | espera: " + DIAS_DE_ESPERA + " dias");
  console.log("  asunto: " + ASUNTO);
  console.log("  html: " + HTML.length + " car | codigo: " + CODIGO);

  if (!APLICAR) {
    console.log("\n  (dry-run: no se escribio nada. Usa --aplicar)");
    return;
  }

  // ---------------------------------------------------------------- 1. limpiar
  // Ni los flows ni las plantillas se pueden editar por API (PATCH solo
  // acepta "status"), asi que el script es de una sola pasada: borra lo que
  // haya con el mismo nombre y lo vuelve a crear.
  let r = await call("GET", "/flows/");
  const flowsViejos = (r.j.data || []).filter((f) => f.attributes.name === NOMBRE_FLOW);
  for (const f of flowsViejos) {
    const d = await call("DELETE", "/flows/" + f.id + "/");
    console.log("  1. flow anterior " + f.id + " (" + f.attributes.status + ") borrado: " + d.status);
  }
  r = await call("GET", "/templates/");
  const plantillasViejas = (r.j.data || []).filter((t) => t.attributes.name === NOMBRE_TEMPLATE);
  for (const t of plantillasViejas) {
    const d = await call("DELETE", "/templates/" + t.id + "/");
    console.log("  1. plantilla anterior " + t.id + " borrada: " + d.status);
  }

  // ---------------------------------------------------------------- 2. plantilla
  r = await call("POST", "/templates/", {
    data: {
      type: "template",
      attributes: {
        name: NOMBRE_TEMPLATE,
        editor_type: "CODE",
        html: HTML,
      },
    },
  });
  if (r.status !== 201) {
    console.log("  ERROR creando la plantilla: " + r.status + " " + JSON.stringify(r.j).slice(0, 300));
    return;
  }
  const templateId = r.j.data.id;
  console.log("  2. plantilla creada: " + templateId + " (" + HTML.length + " car de html)");

  // ---------------------------------------------------------------- 3. flow
  // El flow se crea entero con la "definition": trigger + espera + envio.
  const flows = [];

  const definicion = {
    entry_action_id: "espera",
    triggers: [{ type: "metric", id: METRICA_PLACED_ORDER }],
    actions: [
      {
        temporary_id: "espera",
        type: "time-delay",
        links: { next: "enviar" },
        data: { unit: "days", value: DIAS_DE_ESPERA, timezone: "profile" },
      },
      {
        temporary_id: "enviar",
        type: "send-email",
        links: { next: null },
        data: {
          status: "live",
          message: {
            template_id: templateId,
            subject_line: ASUNTO,
            preview_text: PREHEADER,
            from_email: "contacto@mondano.cl",
            from_label: "MONDANO",
            reply_to_email: "contacto@mondano.cl",
            smart_sending_enabled: true,
            transactional: false,
          },
        },
      },
    ],
  };

  {
    r = await call("POST", "/flows/", {
      data: {
        type: "flow",
        attributes: { name: NOMBRE_FLOW, definition: definicion },
      },
    });
    if (r.status !== 201) {
      console.log("  ERROR creando el flow: " + r.status + " " + JSON.stringify(r.j).slice(0, 500));
      return;
    }
    const flowId = r.j.data.id;
    console.log("  3. flow creado: " + flowId);
    r = await call("PATCH", "/flows/" + flowId + "/", {
      data: { type: "flow", id: flowId, attributes: { status: "live" } },
    });
    console.log("     publicado: " + (r.j.data ? r.j.data.attributes.status : r.status));
  }

  // ---------------------------------------------------------------- 4. verificar y limpiar
  r = await call("GET", "/flows/");
  console.log("\n  === flows de la cuenta ===");
  (r.j.data || []).forEach((f) => {
    console.log("  " + f.id + " | " + f.attributes.name + " | " + f.attributes.status + " | trigger: " + f.attributes.trigger_type);
  });
  let plantillaEnUso = null;
  for (const f of (r.j.data || [])) {
    if (f.attributes.name !== NOMBRE_FLOW) continue;
    const ra = await call("GET", "/flows/" + f.id + "/flow-actions/");
    console.log("\n  acciones de " + f.id + ":");
    for (const a of ra.j.data || []) {
      console.log("    " + a.id + ": " + a.attributes.action_type + " (" + a.attributes.status + ")");
      if (a.attributes.action_type !== "SEND_EMAIL") continue;
      const rm = await call("GET", "/flow-actions/" + a.id + "/flow-messages/");
      (rm.j.data || []).forEach((m) => {
        console.log("    email: \"" + m.attributes.content.subject + "\"");
        console.log("    preheader: " + (m.attributes.content.preview_text || "(vacio)"));
        console.log("    de: " + m.attributes.content.from_label + " <" + m.attributes.content.from_email + ">");
        if (m.relationships && m.relationships.template) {
          plantillaEnUso = m.relationships.template.data.id;
          console.log("    plantilla en uso: " + plantillaEnUso);
        }
      });
    }
  }
  // Klaviyo clona la plantilla al crear el flow: se borra la que no se usa
  r = await call("GET", "/templates/");
  for (const t of r.j.data || []) {
    if (t.attributes.name !== NOMBRE_TEMPLATE) continue;
    if (t.id === plantillaEnUso) continue;
    const d = await call("DELETE", "/templates/" + t.id + "/");
    console.log("\n  plantilla huerfana " + t.id + " borrada: " + d.status);
  }
})();
