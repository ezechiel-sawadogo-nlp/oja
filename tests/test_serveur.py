"""
Tests du mode serveur (server/server.js) : état injecté dans la page, écritures envoyées au
serveur, données partagées entre deux navigateurs (donc deux appareils), mot de passe,
webhook WhatsApp (vérification + réception), réinitialisation, et fonctionnement inchangé
sans serveur.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

PORT = 8993
BASE_URL = f"http://localhost:{PORT}"
passed = 0
failed = 0


def check(label, condition):
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {label}")
    else:
        failed += 1
        print(f"  FAIL {label}")


def skip_onboarding(page):
    if page.locator("#onboarding:not(.hidden)").count():
        page.click('[data-category="Vêtements"]')
        page.click("#continue-button"); page.click("#load-demo-button")
        page.wait_for_selector("#onboarding.hidden", state="attached")


def http(method, path, body=None, auth=None):
    request = urllib.request.Request(BASE_URL + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
    if auth:
        import base64
        request.add_header("Authorization", "Basic " + base64.b64encode(f":{auth}".encode()).decode())
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode() or "null")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def raw_get(path):
    """GET sans normalisation d'URL (pour tester les tentatives de contournement)."""
    import http.client
    connection = http.client.HTTPConnection("localhost", PORT, timeout=5)
    connection.request("GET", path)
    response = connection.getresponse()
    body = response.read().decode("utf-8", "replace")
    connection.close()
    return response.status, body


def signed_post(path, payload, secret):
    import hashlib
    import hmac
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(BASE_URL + path, method="POST", data=raw, headers={"Content-Type": "application/json", "X-Hub-Signature-256": signature})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def start_server(data_file, env_extra=None):
    # Variables vides explicites : un .env local (mot de passe, secrets) ne doit pas fausser les tests.
    env = {**os.environ, "OJA_DATA": data_file, "OJA_PASSWORD": "", "WHATSAPP_VERIFY_TOKEN": "", "WHATSAPP_APP_SECRET": "", **(env_extra or {})}
    process = subprocess.Popen(["node", "server/server.js", "--port", str(PORT)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE_URL + "/api/health", timeout=1)
            return process
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("serveur non démarré")


def run():
    workdir = tempfile.mkdtemp()
    data_file = os.path.join(workdir, "oja-state.json")

    # ============================================================
    # PARTIE 1 — Sans mot de passe : état injecté, partage entre navigateurs
    # ============================================================
    server = start_server(data_file, {"WHATSAPP_VERIFY_TOKEN": "jeton-test"})
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_context().new_page()
            page.goto(BASE_URL)
            check("la page est servie par le serveur avec l'état injecté", page.evaluate("typeof window.OJA_STATE === 'object' && STORE.serverMode === true"))
            skip_onboarding(page)
            page.click("#profile-button")
            page.wait_for_selector("#profile-modal[open]")
            page.fill("#profile-shop-name-input", "Boutique Serveur")
            page.click("#profile-form .save-button")
            page.wait_for_timeout(600)  # le lot d'écritures part après 250 ms
            status, state = http("GET", "/api/state")
            check("la modification est arrivée sur le serveur", status == 200 and state["data"].get("oja-profile", {}).get("shopName") == "Boutique Serveur")
            check("le fichier de données existe sur le disque", os.path.exists(data_file) and "Boutique Serveur" in open(data_file, encoding="utf-8").read())

            # Un second navigateur (= un autre appareil, localStorage vide) voit les mêmes données
            other = browser.new_context().new_page()
            other.goto(BASE_URL)
            check("un autre appareil voit le nom de boutique enregistré", other.inner_text("#profile-shop-name") == "Boutique Serveur")
            check("l'onboarding n'est pas redemandé sur l'autre appareil (catégories partagées)", other.locator("#onboarding.hidden").count() == 1)

            # Modification depuis l'autre appareil -> le premier est prévenu
            other.click('[data-view="catalog"]')
            other.click('.primary-button[data-action="Ajouter un produit"]')
            other.wait_for_selector("#product-modal[open]"); other.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
            other.fill("#product-name", "Boubou brodé")
            other.fill("#product-price", "25000")
            other.fill("#product-stock", "2")
            other.select_option("#product-category", "Vêtements")
            other.fill("#clothes-size-values", "M")
            other.fill("#clothes-color-values", "Blanc")
            other.fill("#clothes-material", "Bazin")
            other.click(".save-button")
            other.wait_for_timeout(600)
            page.wait_for_timeout(9000)  # sondage toutes les 8 s
            check("le premier appareil est prévenu qu'un autre a modifié les données", page.is_visible("#sync-banner") and "autre appareil" in page.inner_text("#sync-banner"))
            page.click("#sync-reload")
            page.wait_for_timeout(500)
            page.click('[data-view="catalog"]')
            check("après rechargement, le nouveau produit est là", "Boubou brodé" in page.inner_text("#catalog-products"))

            # Une conversation sur un appareil apparaît sur l'autre
            page.locator(".catalog-item", has_text="Boubou brodé").get_by_text("Simuler une cliente").click()
            page.wait_for_timeout(200)
            page.fill("#composer-input", "vous livrez à Bobo ?")
            page.click("#send-button")
            page.wait_for_timeout(700)
            other.reload()
            other.wait_for_timeout(300)
            other.click('[data-view="conversations"]')
            check("le fil de conversation est visible depuis l'autre appareil", other.locator(".thread-card", has_text="Boubou brodé").count() == 1)
            browser.close()

        # Webhook WhatsApp
        status, body = http("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=jeton-test&hub.challenge=12345")
        check("webhook : la vérification Meta renvoie le challenge", status == 200 and body == 12345)
        status, body = http("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=1")
        check("webhook : mauvais jeton refusé", status == 403)
        payload = {"entry": [{"changes": [{"value": {"messages": [{"from": "22670000000", "id": "wamid.1", "type": "text", "text": {"body": "c'est combien ?"}, "timestamp": "1"}]}}]}]}
        status, body = http("POST", "/api/whatsapp/webhook", payload)
        inbox = os.path.join(workdir, "whatsapp-inbox.jsonl")
        check("webhook : un message reçu est journalisé", status == 200 and body["received"] == 1 and os.path.exists(inbox) and "c'est combien" in open(inbox, encoding="utf-8").read())

        # Fichiers statiques : seule l'interface est servie
        env_file = os.path.join(ROOT, ".env")
        created_env = not os.path.exists(env_file)
        if created_env:
            open(env_file, "w").write("OJA_PASSWORD=ne-doit-jamais-fuiter\n")
        try:
            leaks = ["/.env", "//.env", "/%2e%2e/", "/server/data/oja-state.json", "//server/data/oja-state.json", "/Server/data/oja-state.json",
                     "/server%2Fdata%2Foja-state.json", "/server/server.js", "/tests/test_serveur.py", "/corpus/corpus_clientes.jsonl", "/../package.json", "/%"]
            results = {path: raw_get(path) for path in leaks}
            # Seules réponses admises : 404, ou la page d'accueil quand l'URL se normalise en « / ».
            safe = all(code == 404 or (code == 200 and "<html" in body and "ne-doit-jamais-fuiter" not in body) for code, body in results.values())
            check("statique : aucun fichier hors interface n'est servi (.env, données, serveur, tests)", safe)
        finally:
            if created_env:
                os.remove(env_file)
        check("statique : l'interface reste servie (app.js, styles.css)", raw_get("/app.js")[0] == 200 and raw_get("/styles.css")[0] == 200)

        # Réinitialisation par l'API
        status, body = http("DELETE", "/api/state")
        status, state = http("GET", "/api/state")
        check("DELETE /api/state vide les données", state["data"] == {})
    finally:
        server.terminate()
        server.wait()

    # ============================================================
    # PARTIE 2 — Avec mot de passe
    # ============================================================
    server = start_server(data_file, {"OJA_PASSWORD": "secret123"})
    try:
        status, body = http("GET", "/api/state")
        check("mot de passe : sans identifiant, 401", status == 401)
        status, body = http("GET", "/api/state", auth="mauvais")
        check("mot de passe : faux mot de passe refusé", status == 401)
        status, body = http("GET", "/api/state", auth="secret123")
        check("mot de passe : bon mot de passe accepté", status == 200)
        status, body = http("GET", "/api/health")
        check("la route de santé reste ouverte (supervision)", status == 200)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(http_credentials={"username": "", "password": "secret123"})
            page = context.new_page()
            page.goto(BASE_URL)
            check("le navigateur passe avec le mot de passe", page.locator("#onboarding").count() == 1 and page.evaluate("STORE.serverMode === true"))
            browser.close()
    finally:
        server.terminate()
        server.wait()

    # ============================================================
    # PARTIE 2 bis — Webhook signé (WHATSAPP_APP_SECRET)
    # ============================================================
    server = start_server(data_file, {"WHATSAPP_APP_SECRET": "secret-app"})
    try:
        payload = {"entry": [{"changes": [{"value": {"messages": [{"from": "22670000001", "id": "wamid.2", "type": "text", "text": {"body": "bonjour"}, "timestamp": "2"}]}}]}]}
        check("webhook signé : sans signature, refusé", http("POST", "/api/whatsapp/webhook", payload)[0] == 401)
        check("webhook signé : mauvaise signature, refusée", signed_post("/api/whatsapp/webhook", payload, "autre-secret") == 401)
        check("webhook signé : bonne signature, acceptée", signed_post("/api/whatsapp/webhook", payload, "secret-app") == 200)
    finally:
        server.terminate()
        server.wait()

    # ============================================================
    # PARTIE 3 — Sans serveur (serveur statique) : rien ne change
    # ============================================================
    static = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(BASE_URL)
            check("servi statiquement : mode localStorage", page.evaluate("STORE.serverMode === false"))
            skip_onboarding(page)
            page.reload()
            check("servi statiquement : les catégories persistent dans le navigateur", page.locator("#onboarding.hidden").count() == 1)
            browser.close()
    finally:
        static.terminate()

    print(f"\n{passed}/{passed + failed} tests passés")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
