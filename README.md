# Mondano Bot — Envíos + Instagram/WhatsApp

Webhook en Vercel que recibe mensajes de Instagram (y prepara WhatsApp),
consulta el estado del envío en Supabase + Envia y responde con x.ai.

## Rutas

| Ruta | Método | Qué hace |
|---|---|---|
| `/webhook/instagram` | `GET` | Handshake de Meta (`hub.challenge`) |
| `/webhook/instagram` | `POST` | Recibe DMs de Instagram, responde con IA |
| `/webhook/meta` | `GET`/`POST` | Webhook genérico de Meta (WhatsApp) |
| `/webhook/shopify` | `POST` | Webhook de Shopify (SMS de confirmación vía Twilio) |
| `/tracking/:order_id` | `GET` | Estado de un pedido (`MON3007`) |
| `/envia/:tracking_id` | `GET` | Estado crudo de Envia (`712913101224`) |

## Configuración

1. Copiar `.env.example` a `.env` y completar las credenciales.
2. Publicar las variables en Vercel:

```sh
vercel env add META_ACCESS_TOKEN production --value "<token>" \
  --project envia-webhook --sensitive --force --yes
vercel deploy --prod --yes
```

> **Importante:** cambiar `META_ACCESS_TOKEN` en `.env` no cambia nada en
> producción. Hay que volver a publicarlo en Vercel **y** redesplegar.
> Un token viejo produce `(#100) ... subcode 2534014` al enviar.

3. Suscribir los webhooks de Meta (ver más abajo).

## Suscripción de webhooks (Instagram)

La parte que más cuesta encontrar. Hay **dos** suscripciones y ambas hacen falta:

```sh
node scripts/setup_meta_integration.js 17841408417156397
```

**Nivel de app** — sin esto Meta **no entrega ni un solo evento**, aunque la
URL del webhook esté guardada y el panel muestre todo en verde:

```sh
POST /{app-id}/subscriptions
  ?object=instagram
  &callback_url=https://envia-webhook.vercel.app/webhook/instagram
  &verify_token=<META_VERIFY_TOKEN>
  &fields=messages,messaging_postbacks,messaging_seen,message_reactions,messaging_referral
```

Una suscripción **sin `fields`** no entrega nada. Es el error clásico: todo
parece configurado y nunca llega un webhook.

**Nivel de cuenta**:

```sh
POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages,...
```

### Cómo saber si funciona

Meta responde al guardar la suscripción con un `GET` de verificación. Si en los
logs de Vercel no aparece un `GET /webhook/instagram` → `[instagram] webhook
verificado` al guardar, la suscripción no quedó activa.

## Cómo identifica el bot el pedido

El caso real es que el cliente escribe `hola` o `¿qué pasó con mi pedido?` **sin**
dar el número de pedido. El bot lo resuelve en cascada:

| # | Vía | Nota |
|---|---|---|
| 1 | Número de pedido en el texto | `MON3007`, `mon3007`, `pedido 3007`, `3007` |
| 2 | Memoria de la conversación | Lo que el cliente dijo antes (30 min) |
| 3 | Se le pide el número de pedido | Formato `MON3007`, **sin guion** |

**No se pide el teléfono del cliente.** En Instagram el id del usuario no es un
teléfono, así que el número de pedido es la única vía. Pedir el teléfono
complicaría la conversación sin aportar nada.

En **WhatsApp** el `from` del webhook *es* el teléfono del cliente, así que ahí
el bot sabe de quién se trata sin preguntar nada. Eso es identidad del canal,
no un dato que se le recabe.

El teléfono no está en Supabase: vive en Envia (`destination.phone`). Por eso la
búsqueda por teléfono (solo para WhatsApp) consulta los envíos recientes y
compara el teléfono del destinatario de cada uno.

Si el teléfono coincide con **varios** envíos, el bot responde por el más
reciente y pide confirmación.

### Memoria de conversación

`conversation.js` guarda, por cliente, el último número de pedido que nos dio,
para que los mensajes siguientes (`¿y cuándo llega?`) no repitan el dato.

Implementación actual: memoria del proceso (`Map`) con TTL de 30 min. En un cold
start de Vercel se pierde, por eso el bot **siempre** vuelve a pedir el dato si
no lo tiene. Para hacerlo durable, reemplazar el `Map` por una tabla de
Supabase — la interfaz `get / remember / forget` no cambia (ver el SQL sugerido
en el propio archivo).

## Errores frecuentes

| Error | Causa | Solución |
|---|---|---|
| `(#100) subcode 2534014` "No se puede encontrar al usuario solicitado" | Token viejo en Vercel (sin scopes de messaging) | republicar `META_ACCESS_TOKEN` + redesplegar |
| `(#4) Application request limit reached` | Límite de envío por app (transitorio) | se reintenta solo con backoff |
| No llegan logs de Vercel | Suscripción a nivel de app sin `fields` | `POST /{app-id}/subscriptions` |
| `x-ad-api-version-warning: v23.0 has been deprecated` | Versión de Graph API antigua | `META_GRAPH_VERSION=v27.0` |

## Payload de Instagram: `sender` vs `recipient`

```json
"messaging": [{
  "sender":    { "id": "IGSID" },   // el CLIENTE que escribió -> destinatario de la respuesta
  "recipient": { "id": "IGID" },    // nuestra cuenta de negocio -> ig-user-id del path
}]
```

Responder a `recipient.id` es mandarse un mensaje a uno mismo.

## Scripts

- `scripts/setup_meta_integration.js` — scopes + suscripción + estado final.
- `scripts/test_resolucion.js` — 41 tests de extracción de pedido/teléfono,
  memoria de conversación y contextos. `node scripts/test_resolucion.js`
- `scripts/test_conversacion.js` — prueba el flujo completo con el handler real
  y un remitente falso (no envía nada a Instagram).
- `validate_meta.js` — validación de credenciales de Meta.
- `setup_meta_creds.sh` — alta de credenciales en Vercel.
