# Estado real de WhatsApp (checklist oficial de Meta)

Obtenido con las herramientas MCP de Meta (`scripts/mcp_client.js`), que leen
el estado real en los servidores de Facebook.

## Onboarding de la cuenta de WhatsApp

```
[done] Business profile      Legal name, address and website are filled in.
[done] Developer app         A WhatsApp-enabled app is connected to this business.
[done] Phone number          +56 9 2977 3980 is registered. Ready to send.
[done] Webhooks              Callback URL set on mondano_mensajes (2595593107610545).
                             Subscribed fields: account_update, message_statuses,
                             message_template_status_update, messages,
                             phone_number_name_update.
[done] Account subscription  unknown sends its events to mondano_mensajes.
[todo] App published         mondano_mensajes is in DEVELOPMENT MODE (not published).
                             An app in development mode may not be sent real webhooks.
[todo] Payment method        No payment method, so billable messages are accepted
                             but the recipient will most likely not see them.
```

Negocio: `111337664819723` (Mondano) — verificado ✅, perfil completo ✅
App: `2595593107610545` (mondano_mensajes)
Número: `530005643535929` = +56 9 2977 3980, `onboarding_state: registered`
WABA: `554629607724135`

## Callback URLs (verificado por API)

Cada caso de uso tiene SU PROPIA callback URL. Cambiar una no afecta a la otra.

```
object: instagram                    -> /webhook/instagram
  campos: messages, messaging_postbacks, messaging_seen, message_reactions, messaging_referral
object: whatsapp_business_account    -> /webhook/meta
  campos: account_update, message_statuses, message_template_status_update,
          messages, phone_number_name_update
```

Para revisarlo: `node scripts/ver_webhooks.js`

## Los dos pasos que faltan

### 1. Publicar la app (bloquea los webhooks reales)

    https://developers.facebook.com/apps/2595593107610545/go_live/

Lo que más se atora: falta la **URL de política de privacidad** en
Basic Settings. La página "Go Live" lista lo que falte.

### 2. Método de pago (sin esto el cliente no ve los mensajes)

    https://business.facebook.com/billing_hub/accounts/details/?business_id=111337664819723&asset_id=554629607724135&wizard_name=ADD_PM

### 3. Token permanente del System User

    https://business.facebook.com/latest/settings/system_users/?business_id=111337664819723

Permisos requeridos: `business_management`, `whatsapp_business_messaging`,
`whatsapp_business_management`. Asignar la app ("Manage app") y la cuenta
de WhatsApp ("Manage WhatsApp Business accounts") con **Control total**
antes de generar el token.

Guia: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started#step-5-create-a-system-user-and-generate-a-permanent-access-token

> Este paso puede pedir la **aprobacion de otra persona** (regla de dos
> personas de Meta). Si aparece, hay que invitar a un admin con Control
> total (Business Settings > Usuarios > Personas > Invitar personas, con
> acceso temporal de 3 a 75 dias) para que approve.

## Token del MCP

`docs/mcp-whatsapp-token.json` (OAuth + PKCE contra
`mcp.facebook.com/whatsapp_business_tools`). Es **solo para el servidor MCP**:

    GET /me/permissions
    → "(#10) This app is not authorized to access the Graph API.
       It is restricted to MCP server access only."

Sirve para las herramientas MCP (enviar codigo de verificacion, publicar la
app, listar cuentas...), **no** para la Graph API.

## Aplicar el estado al bot

- `META_ACCESS_TOKEN` → Graph API (Instagram + conversaciones + envio IG)
- `META_WHATSAPP_TOKEN` → envio de WhatsApp por Cloud API
- `META_WABA_ID=554629607724135`, `META_PHONE_NUMBER_ID=530005643535929`
- `FEATURE_WHATSAPP=0` → apagado hasta que el numero este verificado
