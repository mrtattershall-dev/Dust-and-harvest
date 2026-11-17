#!/usr/bin/env bash
# Installs SkyAI Teammate on this computer (Ubuntu or similar Linux).
#   ./install.sh            first install
#   ./install.sh --update   after a Minecraft update (keeps your world)
#   ./install.sh --classic  original Skyblock start (lava bucket and ice, no generator built)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is needed. Install it from https://nodejs.org (or: sudo apt install -y nodejs npm) and run this again."
  exit 1
fi
if ! node -e 'process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)'; then
  echo "Node.js $(node -v) is too old; version 20 or newer is needed. See https://nodejs.org"
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is needed. Install it with:  sudo apt install -y unzip   and run this again."
  exit 1
fi

echo "This will download the official Minecraft Bedrock Dedicated Server from minecraft.net."
echo "By continuing you accept the Minecraft End User License Agreement (https://minecraft.net/eula)"
echo "and Microsoft's Privacy Policy (https://go.microsoft.com/fwlink/?LinkId=521839)."
read -r -p "Type yes to accept and continue: " answer
if [ "$answer" != "yes" ]; then
  echo "Not installed."
  exit 1
fi

npm install --no-audit --no-fund
node server/setup.mjs --accept-eula "$@"

echo
echo "Installed. Next:"
echo "  1. Start it:            npm start"
echo "  2. Open the web page it prints, go to Settings, and choose your AI model."
echo "  3. On the phone: Minecraft > Play > Servers > Add Server > this computer's IP, port 19132."
