#!/usr/bin/env python3
"""Génère l'autorité locale « E-Ticket MJS » et un certificat HTTPS pour un nom de domaine (nécessite OpenSSL).
Usage : python certificats/generer_certificat.py [domaine]      (défaut : eticket-mjs.local)
Résultat dans ce dossier : ca-eticket-mjs.crt (à installer comme « autorité de confiance »), <domaine>.crt / .key / .fullchain.crt.
La clé privée de l'autorité est SUPPRIMÉE après signature : personne ne peut émettre d'autres certificats avec elle,
et l'autorité est limitée (« name constraints ») à ce domaine, localhost et 127.0.0.1.
Pour un vrai nom de domaine public (ex. billetterie.sports.gouv.ml), n'utilisez PAS ceci : voir deploy/Caddyfile (Let's Encrypt automatique)."""
import os, shutil, subprocess, sys, tempfile
d = sys.argv[1] if len(sys.argv) > 1 else "eticket-mjs.local"
here = os.path.dirname(os.path.abspath(__file__))
ossl = shutil.which("openssl")
if not ossl:
    sys.exit("OpenSSL est introuvable (sous Windows : installer Git for Windows, qui l'inclut, ou OpenSSL).")
def run(*a):
    r = subprocess.run([ossl, *a], capture_output=True, text=True)
    if r.returncode: sys.exit("OpenSSL a échoué : " + r.stderr.strip())
with tempfile.TemporaryDirectory() as t:
    cak, cac = os.path.join(t, "ca.key"), os.path.join(here, "ca-eticket-mjs.crt")
    open(os.path.join(t, "ca.cnf"), "w").write(f"""[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
O=MJS Mali - presentation E-Ticket
CN=Autorite locale E-Ticket MJS
[v3]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
nameConstraints=critical,permitted;DNS:{d},permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255,permitted;IP:0:0:0:0:0:0:0:1/ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
""")
    run("req", "-x509", "-newkey", "rsa:3072", "-nodes", "-keyout", cak, "-out", cac, "-days", "1095", "-sha256", "-config", os.path.join(t, "ca.cnf"))
    key, csr, crt = (os.path.join(here, d + e) for e in (".key", ".csr", ".crt"))
    open(os.path.join(t, "srv.cnf"), "w").write(f"""[req]
distinguished_name=dn
prompt=no
[dn]
O=Ministere Jeunesse et Sports du Mali
CN={d}
""")
    open(os.path.join(t, "ext.cnf"), "w").write(f"""basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:{d},DNS:localhost,IP:127.0.0.1,IP:::1
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
""")
    run("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-config", os.path.join(t, "srv.cnf"))
    run("x509", "-req", "-in", csr, "-CA", cac, "-CAkey", cak, "-CAcreateserial", "-out", crt, "-days", "397", "-sha256", "-extfile", os.path.join(t, "ext.cnf"))
os.remove(csr)
open(os.path.join(here, d + ".fullchain.crt"), "w").write(open(crt).read() + open(cac).read())
try: os.chmod(key, 0o600)
except OSError: pass
print(f"✔ Certificat créé pour {d} (valable 397 jours) dans {here}\n  À installer une fois sur l'ordinateur de présentation : ca-eticket-mjs.crt (voir PRESENTATION.md)")
