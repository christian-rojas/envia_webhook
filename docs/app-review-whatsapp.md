# App Review — permisos de WhatsApp (app `mondano_mensajes`)

App ID: `2595593107610545`
WABA: `554629607724135` · Teléfono: `530005643535929` (+56 9 2977 3980)
Sistema de referencia: https://envia-webhook.vercel.app

---

## 1. Qué falta: la sección "Uso permitido"

En "Enviar a revisión de apps" están verdes: Verificación, Configuración de apps,
Tratamiento de datos, Instrucciones para revisores. Falta **Uso permitido** (círculo vacío).

Ahí van tres cosas:

1. **Los casos de uso** (el de WhatsApp y el de Instagram, con sus permisos).
2. **La justificación de cada permiso** → textos abajo.
3. **La grabación de vídeo de la app en acción** (obligatoria para
   `whatsapp_business_messaging`).

---

## 2. Justificaciones (copiar y pegar)

### `whatsapp_business_messaging`

> Mondano is a Chilean clothing brand. Our app lets customers check the status of
> their order through WhatsApp. When a customer writes to our business WhatsApp
> number with their order number (format MON3007), the app looks the shipment up in
> our shipping system and replies with the current status, the carrier and the
> tracking number. The app only sends messages as a direct reply to the customer's
> own message, within the 24-hour customer service window. It never sends
> broadcasts, campaigns or marketing messages.

### `whatsapp_business_management`

> The app manages the configuration of our WhatsApp Business Account. It reads the
> account's phone numbers (to show whether each number is verified and connected,
> so our operations team knows if the line is ready) and subscribes our webhook to
> the account's `messages` events (`subscribed_apps`) so incoming customer messages
> can be processed. It does not create or modify campaigns, templates, pricing or
> business profiles.

### (si lo pide) `instagram_basic` / `instagram_manage_messages` — ya están concedidos

No hay que volver a justificarlos, pero si el formulario los lista:

> Our Instagram messaging integration lets customers check their order status by
> direct message, using the same lookup as WhatsApp. We use `instagram_basic` to
> read the connected Instagram professional account and `instagram_manage_messages`
> to send and receive direct messages.

---

## 3. Instrucciones para el revisor (copiar y pegar)

> **How to test the WhatsApp integration**
>
> 1. Open WhatsApp and start a chat with our customer service number **+56 9 2977 3980**.
> 2. Send exactly this message:
>
>    `cuando llega mi pedido MON4720`
>
>    (`MON4720` is a real order in our store with an active shipment.)
> 3. Within a few seconds the assistant replies with the order status, the
>    carrier (Chilexpress) and the tracking number, and a link to track it.
> 4. You can follow up with `cuando llega` or `gracias` and it keeps answering
>    about the same order without asking for the order number again.
>
> **What the app does:** it is a delivery-status assistant. It looks up the
> shipment of the order number the customer provides and replies with the status,
> carrier and tracking number. It does not broadcast messages, does not send
> marketing content and does not collect data beyond what is needed to answer.
>
> **No login required.** No credentials are needed to test the app.

---

## 4. Guion del screencast (1–3 min, pantalla + audio o subtítulos)

1. Mostrar el chat de WhatsApp con el bot (número +56 9 2977 3980).
2. Escribir `cuando llega mi pedido MON4720` y enviar.
3. **Grabar la respuesta** (estado + transportista + número de seguimiento).
4. Escribir `cuando llega` de nuevo → mostrar que NO vuelve a pedir el número.
5. Escribir `hola` → mostrar que **no responde** (el bot solo habla de pedidos).
6. Opcional: mostrar el pedido abierto en el admin de Shopify para que se vea que
   el dato sale de ahí.

Tips: nada de datos personales, tapar el teléfono del cliente si aparece, y
subirlo a un link accesible (YouTube no privado) o adjuntarlo en el formulario.

---

## 5. Tarea en paralelo (no depende de la revisión)

**Verificar el número por SMS.** Hoy está `code_verification_status: NOT_VERIFIED`
y `status: DISCONNECTED`: sin verificar no entra ni un mensaje.

Se puede hacer **ya**, sin los scopes del app, desde el panel:

Business Suite → WhatsApp Manager → Números de teléfono → +56 9 2977 3980 →
**Configurar → Verificar número** → pedir código por SMS → ingressar el código.

(El script `scripts/setup_whatsapp.js --request-code` también sirve, pero
necesita los scopes de WhatsApp, que están en revisión. El panel no los necesita.)

---

## 6. Cuando se apruebe

```sh
# 1) Asignar el WABA al system user (Business Suite → Configuración → Usuarios →
#    System users → mondano_mensajes → Asignar recursos → WhatsApp Account)
# 2) Generar un token NUEVO con los scopes (el actual no los trae):
#    Business Suite → Configuración → Usuarios → System users → mondano_mensajes →
#    Generar token de acceso → seleccionar la app + los 2 scopes de WhatsApp
# 3) Publicarlo en Vercel y redesplegar:
vercel env add META_WHATSAPP_TOKEN production --value "<token nuevo>"
vercel deploy --prod

# 4) Suscribir el webhook del WABA y verificar el estado:
node scripts/setup_whatsapp.js 554629607724135 530005643535929

# 5) Comprobar que todo quedó en pie:
node scripts/diagnostico_whatsapp.js
```

---

## 7. El problema del screencast (leer antes de enviar)

Para grabar el vídeo hace falta que el bot **responda de verdad** por WhatsApp, y
eso con la app en vivo exige los scopes ya aprobados. Es circular.

Salida: **poner la app en modo desarrollo** mientras se graba.

- En modo desarrollo, la Cloud API funciona con el token de la app
  (`{app-id}|{app-secret}`), que ya tenemos, sin esperar la revisión.
- Riesgo: en modo desarrollo, Meta limita el acceso a usuarios con rol en la app.
  El bot de **Instagram** podría dejar de responder a los clientes normales
  (los que no son admin/developer/tester de la app).
- Mitigación: el system user está asignado a los activos de Claudio, que
  probablemente es admin de la app, así que puede que siga funcionando. **Se
  comprueba en 2 minutos**: poner la app en desarrollo, redeplegar y mandar un
  mensaje de prueba por Instagram.
- Al terminar: volver a **Publicar** (modo vivo) y recién ahí enviar la revisión.

Alternativa: preguntar en la revisión si aceptan la demostración del flujo sin
la API en vivo (capturas del chat + la lógica de respuesta).
