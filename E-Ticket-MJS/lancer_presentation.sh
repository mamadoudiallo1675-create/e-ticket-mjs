#!/bin/sh
# E-Ticket MJS – lance la présentation (serveur Python HTTPS + moteur). Voir PRESENTATION.md
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || { echo "Python 3 est introuvable (https://www.python.org)."; exit 1; }
grep -q "eticket-mjs.local" /etc/hosts 2>/dev/null || echo "⚠ Ajoutez le domaine :  sudo python3 live_server.py --installer-domaine"
exec python3 live_server.py "$@"
