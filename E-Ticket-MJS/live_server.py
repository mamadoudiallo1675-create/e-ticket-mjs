#!/usr/bin/env python3
"""E-Ticket MJS – serveur de présentation « live » en Python (bibliothèque standard uniquement).

Une seule commande :  python live_server.py
  1. génère (la première fois) les clés d'accès du personnel : administration et contrôle (fichier cles-acces.txt) ;
  2. démarre le moteur E-Ticket (Node.js >= 22.13) en interne, avec ces clés, ses bases de données (dossier donnees/ : 3 bases SQLite + 2 bases de documents) et le paiement SIMULÉ ;
  3. sert le site en HTTPS sur un nom de domaine sécurisé (par défaut https://eticket-mjs.local:8443) :
     fichiers du site servis par Python, API / paiement / temps réel (SSE) relayés vers le moteur ;
  4. redirige http://... (port 8080) vers https://... et ajoute les en-têtes de sécurité (HSTS, CSP, etc.).
Options : --domaine NOM  --port-https 8443  --port-http 8080  --lan (accessible depuis les téléphones du réseau)
          --reload (rechargement automatique pendant le développement)  --nouvelles-cles
          --installer-domaine (ajoute le domaine au fichier hosts ; à lancer en administrateur)  --sans-moteur
"""
import argparse, http.client, http.server, json, mimetypes, os, secrets, shutil, socketserver, ssl, subprocess, sys, threading, time, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "public")
CERT_DIR = os.path.join(ROOT, "certificats")
DATA_DIR = os.path.join(ROOT, "donnees")
KEYS_JSON = os.path.join(ROOT, "cles-acces.json")
KEYS_TXT = os.path.join(ROOT, "cles-acces.txt")
ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"          # sans 0/O/1/I : pas de confusion à la saisie
BACKEND_PORT = int(os.environ.get("ETICKET_BACKEND_PORT", "3100"))
CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "content-length", "host"}


def rand_key(prefix, groups=4, size=5):
    return prefix + "-" + "-".join("".join(secrets.choice(ALPHA) for _ in range(size)) for _ in range(groups))


def load_keys(force=False):
    if os.path.exists(KEYS_JSON) and not force:
        return json.load(open(KEYS_JSON, encoding="utf-8"))
    k = {"admin": [rand_key("MJS-ADM")],
         "controle": {"Porte principale": rand_key("MJS-CTL"), "Porte tribune": rand_key("MJS-CTL"), "Équipe personnel": rand_key("MJS-CTL")}}
    json.dump(k, open(KEYS_JSON, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    write_keys_txt(k)
    return k


def write_keys_txt(k):
    lines = ["E-TICKET MJS – CLÉS D'ACCÈS DU PERSONNEL (CONFIDENTIEL)", "",
             "Générées aléatoirement par live_server.py (non devinables). À ne pas diffuser par courriel ou messagerie.",
             "Pour en créer de nouvelles : python live_server.py --nouvelles-cles", "",
             "ADMINISTRATION (événements, tarifs, remboursements, statistiques, activité ; ouvre aussi le contrôle) :"]
    lines += ["  " + a for a in k["admin"]]
    lines += ["", "CONTRÔLE AUX ENTRÉES (valider les billets uniquement) – une clé par poste, pour pouvoir en révoquer une seule :"]
    lines += [f"  {n:<18} {v}" for n, v in k["controle"].items()]
    lines += ["", "« Connexion personnel » (menu du site) accepte une clé d'administration OU de contrôle ;",
              "le rôle est reconnu automatiquement."]
    open(KEYS_TXT, "w", encoding="utf-8").write("\n".join(lines) + "\n")


def start_backend(keys, domain, https_port):
    node = shutil.which("node")
    if not node:
        sys.exit("✖ Node.js est introuvable. Installez Node.js 22.13 ou plus récent (https://nodejs.org), puis relancez.")
    v = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v").split(".")
    if (int(v[0]), int(v[1])) < (22, 13):
        sys.exit(f"✖ Node.js {'.'.join(v)} est trop ancien : il faut 22.13 ou plus récent.")
    os.makedirs(DATA_DIR, exist_ok=True)
    clean = lambda n: n.replace(",", " ").replace("=", " ")
    adm = keys["admin"]
    env = dict(os.environ, PORT=str(BACKEND_PORT), HOST="127.0.0.1", DB_PATH=os.path.join(DATA_DIR, "utilisateurs.sqlite"), NODE_ENV="development",
               # « Nom=clé » : le nom du compte apparaît dans les journaux (qui a scanné, qui a modifié) ; seules les empreintes des clés sont stockées en base
               ADMIN_KEY=",".join((f"Administration {i + 1}=" if len(adm) > 1 else "Administration=") + k for i, k in enumerate(adm)),
               CONTROL_KEY=",".join(f"{clean(n)}={k}" for n, k in keys["controle"].items()), TRUST_PROXY="1",
               BASE_URL=f"https://{domain}" + ("" if https_port == 443 else f":{https_port}"),
               PROVIDER_ORANGE="mock", PROVIDER_MOOV="mock", PROVIDER_CINETPAY="mock", SMS_PROVIDER="console")
    p = subprocess.Popen([node, "--disable-warning=ExperimentalWarning", "server.js"], cwd=ROOT, env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def pump():
        for l in p.stdout:
            if "clé" not in l.lower() and "key" not in l.lower():      # ne jamais réafficher les clés
                print("   [moteur]", l.rstrip())
    threading.Thread(target=pump, daemon=True).start()
    for _ in range(80):
        if p.poll() is not None:
            sys.exit("✖ Le moteur E-Ticket s'est arrêté au démarrage (voir les messages ci-dessus ; essayez : npm run doctor).")
        try:
            c = http.client.HTTPConnection("127.0.0.1", BACKEND_PORT, timeout=1)
            c.request("GET", "/healthz")
            r = c.getresponse()
            if r.status == 200 and b"E-Ticket" in r.read():
                return p
        except OSError:
            pass
        time.sleep(0.25)
    p.terminate()
    sys.exit("✖ Le moteur E-Ticket ne répond pas.")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "E-Ticket-MJS"
    sys_version = ""
    reload = False

    def log_message(self, fmt, *a):
        if os.environ.get("ETICKET_LOG"):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % a))

    def sec(self):
        self.send_header("Strict-Transport-Security", "max-age=31536000")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")

    def do_GET(self): self.route()
    def do_HEAD(self): self.route()
    def do_POST(self): self.proxy()
    def do_PUT(self): self.proxy()
    def do_DELETE(self): self.proxy()
    def do_OPTIONS(self): self.proxy()

    def route(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/__reload" and self.reload:
            return self.reload_stream()
        if path.startswith(("/api/", "/sandbox/")) or path == "/healthz":
            return self.proxy()
        rel = "index.html" if path == "/" else urllib.parse.unquote(path).lstrip("/")
        f = os.path.normpath(os.path.join(PUB, rel))
        if f.startswith(PUB + os.sep) and os.path.isfile(f):
            return self.static(f)
        return self.proxy()                       # le moteur renvoie sa page « introuvable » habituelle

    def static(self, f):
        data = open(f, "rb").read()
        ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
        if f.endswith(".html"):
            ctype = "text/html; charset=utf-8"
            if self.reload:
                data = data.replace(b"</body>", b"<script>new EventSource('/__reload').onmessage=function(e){if(window.__v&&window.__v!==e.data)location.reload();window.__v=e.data}</script></body>")
        elif f.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif f.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", CSP)
        self.sec()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def reload_stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def stamp():
            m = 0
            for d, _, fs in os.walk(PUB):
                for n in fs:
                    try:
                        m = max(m, int(os.stat(os.path.join(d, n)).st_mtime * 1000))
                    except OSError:
                        pass
            return str(m)
        try:
            while True:
                self.wfile.write(("data: %s\n\n" % stamp()).encode())
                self.wfile.flush()
                time.sleep(1)
        except OSError:
            pass

    def proxy(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        h = {k: v for k, v in self.headers.items() if k.lower() not in HOP and k.lower() not in ("x-forwarded-for", "x-forwarded-proto")}
        h["Host"] = self.headers.get("Host", "")
        h["X-Forwarded-For"] = self.client_address[0]          # remplacé (jamais repris du client) : l'adresse réelle sert aux limites anti-abus
        h["X-Forwarded-Proto"] = "https"
        try:
            c = http.client.HTTPConnection("127.0.0.1", BACKEND_PORT, timeout=3600)
            c.request(self.command, self.path, body=body, headers=h)
            r = c.getresponse()
        except OSError:
            msg = json.dumps({"error": "Le moteur E-Ticket ne répond pas."}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        stream = "text/event-stream" in (r.getheader("Content-Type") or "")
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.sec()
        if stream:
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            try:
                while True:
                    chunk = r.read1(4096)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                c.close()
            return
        data = r.read()
        c.close()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD" and r.status not in (204, 304):
            self.wfile.write(data)


class Redirect(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        host = (self.headers.get("Host") or "").split(":")[0] or self.server.domain
        port = "" if self.server.https_port == 443 else ":" + str(self.server.https_port)
        self.send_response(308)
        self.send_header("Location", f"https://{host}{port}{self.path}")
        self.send_header("Content-Length", "0")
        self.end_headers()
    do_HEAD = do_POST = do_GET

    def log_message(self, *a):
        pass


class Srv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    ctx = None                                 # contexte TLS : la poignée de main se fait dans le thread de chaque connexion (les navigateurs ouvrent des connexions « préparatoires » inactives)

    def get_request(self):
        sock, addr = self.socket.accept()
        if self.ctx:
            sock = self.ctx.wrap_socket(sock, server_side=True, do_handshake_on_connect=False)
        return sock, addr

    def finish_request(self, request, client_address):
        if self.ctx:
            request.settimeout(15)
            request.do_handshake()
            request.settimeout(None)
        super().finish_request(request, client_address)

    def handle_error(self, request, client_address):
        if os.environ.get("ETICKET_LOG"):
            import traceback; traceback.print_exc()
        # connexion interrompue / refusée par le navigateur : sans importance


def install_hosts(domain):
    hosts = r"C:\Windows\System32\drivers\etc\hosts" if os.name == "nt" else "/etc/hosts"
    line = f"127.0.0.1 {domain}"
    try:
        txt = open(hosts, encoding="utf-8").read()
        if domain in txt:
            print(f"✔ {domain} est déjà dans {hosts}")
            return
        open(hosts, "a", encoding="utf-8").write(("" if txt.endswith("\n") else "\n") + line + "\n")
        print(f"✔ Ajouté à {hosts} : {line}")
    except OSError:
        print(f"✖ Écriture impossible (droits administrateur requis). Ajoutez cette ligne au fichier {hosts} :\n    {line}")


def main():
    ap = argparse.ArgumentParser(description="Serveur de présentation E-Ticket MJS")
    ap.add_argument("--domaine", default="eticket-mjs.local")
    ap.add_argument("--port-https", type=int, default=8443)
    ap.add_argument("--port-http", type=int, default=8080)
    ap.add_argument("--lan", action="store_true")
    ap.add_argument("--reload", action="store_true")
    ap.add_argument("--nouvelles-cles", action="store_true")
    ap.add_argument("--installer-domaine", action="store_true")
    ap.add_argument("--sans-moteur", action="store_true")
    a = ap.parse_args()
    if a.installer_domaine:
        install_hosts(a.domaine)
        return
    keys = load_keys(a.nouvelles_cles)
    if a.nouvelles_cles:
        print("✔ Nouvelles clés générées dans cles-acces.txt")
    crt, key = os.path.join(CERT_DIR, a.domaine + ".crt"), os.path.join(CERT_DIR, a.domaine + ".key")
    if not (os.path.exists(crt) and os.path.exists(key)):
        sys.exit(f"✖ Certificat introuvable pour « {a.domaine} » dans certificats/. Lancez : python certificats/generer_certificat.py {a.domaine}")
    backend = None if a.sans_moteur else start_backend(keys, a.domaine, a.port_https)
    Handler.reload = a.reload
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    chain = os.path.join(CERT_DIR, a.domaine + ".fullchain.crt")
    ctx.load_cert_chain(chain if os.path.exists(chain) else crt, key)
    https = Srv((host, a.port_https), Handler)
    https.ctx = ctx
    threading.Thread(target=https.serve_forever, daemon=True).start()
    try:
        red = Srv((host, a.port_http), Redirect)
        red.domain, red.https_port = a.domaine, a.port_https
        threading.Thread(target=red.serve_forever, daemon=True).start()
    except OSError:
        print(f"  (port HTTP {a.port_http} occupé : redirection http -> https non activée)")
    url = f"https://{a.domaine}" + ("" if a.port_https == 443 else f":{a.port_https}")
    print("\n" + "=" * 66)
    print(f"  E-Ticket MJS – prêt\n  Site public ........ {url}/\n  Administration ..... {url}/admin.html\n  Contrôle ........... {url}/controle.html")
    print(f"  Clés du personnel .. {KEYS_TXT}\n  Paiements .......... SIMULÉS (aucun argent réel)\n  Données ............ {DATA_DIR}")
    print("=" * 66)
    print(f"Si le navigateur affiche « connexion non sécurisée » : installez certificats/ca-eticket-mjs.crt (voir PRESENTATION.md)\net vérifiez que {a.domaine} est dans le fichier hosts (python live_server.py --installer-domaine).")
    print("Ctrl+C pour arrêter.")
    try:
        while True:
            time.sleep(1)
            if backend and backend.poll() is not None:
                sys.exit("✖ Le moteur s'est arrêté.")
    except KeyboardInterrupt:
        pass
    finally:
        if backend:
            backend.terminate()


if __name__ == "__main__":
    main()
