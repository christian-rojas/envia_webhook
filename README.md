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
- `validate_meta.js` — validación de credenciales de Meta.
- `setup_meta_creds.sh` — alta de credenciales en Vercel.
