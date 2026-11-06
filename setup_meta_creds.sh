#!/usr/bin/env bash
# Configura y valida las credenciales de Meta + x.ai en Vercel.
#
# Uso:
#   ./setup_meta_creds.sh
#
# Pide los valores de forma interactiva (no quedan en el historial) y los
# escribe en Vercel con vercel env add --sensitive.

set -euo pipefail

export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"

PROJECT="envia-webhook"
STORE="mondano-chile"
API_VERSION="v23.0"

cd "$(dirname "$0")"

read_secret() {
  local prompt="$1" var_name="$2" default="${3:-}"
  local value=""
  if [ -n "$default" ]; then
    echo "$prompt [ya configurado, Enter para dejar igual]: " >&2
  else
    echo "$prompt: " >&2
  fi
  read -r -s value </dev/tty
  echo >&2
  if [ -z "$value" ] && [ -n "$default" ]; then
    echo "  -> se mantiene el valor actual" >&2
    return 0
  fi
  if [ -z "$value" ]; then
    echo "  !! vacio, se omite" >&2
    return 1
  fi
  vercel env rm "$var_name" --project "$PROJECT" --yes --force >/dev/null 2>&1 || true
  vercel env add "$var_name" --value "$value" --project "$PROJECT" --sensitive --force --yes production >/dev/null 2>&1
  echo "  -> $var_name actualizado" >&2
}

echo "==============================================="
echo " Configuracion de credenciales Meta + x.ai"
echo "==============================================="
echo

read_secret "App Secret de Meta (App Settings > Basic)" "META_APP_SECRET"
read_secret "Access Token de Meta (SUAT / Page token)" "META_ACCESS_TOKEN"
read_secret "API key de x.ai (console.x.ai)" "XAI_API_KEY"

# Opcional: IG Account ID. Si se deja vacio se usa /me/messages
echo "Instagram Account ID (IGSID) - opcional, Enter para omitir: " >&2
IG_ID=""
read -r IG_ID </dev/tty
if [ -n "$IG_ID" ]; then
  vercel env rm "META_INSTAGRAM_ACCOUNT_ID" --project "$PROJECT" --yes --force >/dev/null 2>&1 || true
  vercel env add "META_INSTAGRAM_ACCOUNT_ID" --value "$IG_ID" --project "$PROJECT" --sensitive --force --yes production >/dev/null 2>&1
  echo "  -> META_INSTAGRAM_ACCOUNT_ID actualizado" >&2
fi

echo
echo "Desplegando..."
vercel deploy --prod --yes 2>&1 | grep -E "ready|error" | head -3

echo
echo "Validando..."
node validate_meta.js
