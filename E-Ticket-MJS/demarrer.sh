#!/bin/sh
# Lance le serveur E-Ticket (développement) et ouvre le site. Nécessite Node.js 22.13 ou plus récent.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js est introuvable. Installez Node.js 22.13+ : https://nodejs.org"; exit 1; fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then echo "Node.js $(node -v) est trop ancien : il faut 22.13 ou plus récent (https://nodejs.org)."; exit 1; fi
node deploy/doctor.js >/tmp/eticket-doctor.txt 2>&1 || { cat /tmp/eticket-doctor.txt; echo; echo "Corrigez les points ci-dessus (voir DOCUMENTATION.md §17), puis relancez."; exit 1; }
echo "Serveur E-Ticket : lisez l'adresse affichée ci-dessous (« Ouvrez ce site dans le navigateur »). Ctrl+C pour arrêter."
( sleep 3; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1 ) &
exec node --disable-warning=ExperimentalWarning server.js
