"""
Tests du lot "Panier & compagnie" : panier multi-produits, décrément du stock, photos par
variante, paiement échelonné configurable, assistant de secours (Ollama simulé par
interception réseau), export CSV des commandes, bannière premier article, son (réglage).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import json
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8968"
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


def txt(value):
    return value.replace("\u202f", " ").replace("\u00a0", " ")


def make_png(path, color=(255, 0, 0)):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00" + bytes(color)))
    with open(path, "wb") as f:
        f.write(sig + ihdr + idat + chunk(b"IEND", b""))


def skip_onboarding(page, category="Vêtements"):
    page.click(f'[data-category="{category}"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")
    page.wait_for_timeout(150)


def last_reply(page):
    return txt(page.inner_text(".bubble.outgoing >> nth=-1"))


def recent_replies(page, n=2):
    """Les n dernières bulles d'Ọjà : la réponse, puis la question de la commande reposée."""
    return txt(" ".join(page.locator(".bubble.outgoing").all_inner_texts()[-n:]))


def buttons(page):
    return page.locator("#suggestions button").all_inner_texts()


def click_button(page, text):
    page.locator("#suggestions button", has_text=text).first.click()
    page.wait_for_timeout(150)


def seed(page, products, categories):
    page.evaluate("([p, c]) => { localStorage.setItem('oja-products', JSON.stringify(p)); localStorage.setItem('oja-categories', JSON.stringify(c)); }", [products, categories])
    page.reload()
    page.wait_for_timeout(200)


MEDIA = {"photos": [], "wornCount": 0, "video": "", "variants": []}
ROBE = {"id": "robe", "name": "Robe satin beige", "price": 18500, "stock": 2, "category": "Vêtements", "style": "dress", "media": MEDIA,
        "size": {"sizeType": "Standard", "mode": "plusieurs", "values": ["S", "M", "L"]},
        "color": {"mode": "plusieurs", "values": ["Beige", "Noir"]}, "material": "Satin", "gender": "", "setContent": "", "rangeName": ""}
SAC = {"id": "sac", "name": "Sac à main Lune", "price": 17000, "stock": 4, "category": "Accessoires", "style": "bag", "media": MEDIA,
       "itemType": "Sac à main", "color": {"mode": "plusieurs", "values": ["Noir", "Bordeaux"]}, "material": "Cuir",
       "dimension": {"active": False, "dimensionType": "Format", "mode": "unique", "values": [""]}, "packContent": "", "rangeName": ""}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — Panier multi-produits + stock + échelonné
        # ============================================================
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        seed(page, [ROBE, SAC], ["Vêtements", "Accessoires"])
        # profil : livraison + paiement échelonné
        page.click("#profile-button")
        page.wait_for_selector("#profile-modal[open]")
        page.fill("#profile-delivery-zone-input", "Ouagadougou")
        page.fill("#profile-delivery-fee-input", "1000")
        page.fill("#profile-installment-min-input", "20000")
        page.fill("#profile-installment-percent-input", "50")
        page.click("#profile-form .save-button")
        page.wait_for_timeout(200)
        page.click('[data-view="catalog"]')
        check("règles de vente : paiement échelonné affiché depuis le profil", "20 000" in txt(page.inner_text("#rule-grid")) and "50 %" in txt(page.inner_text("#rule-grid")))

        page.locator(".catalog-item", has_text="Robe satin beige").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(200)
        send(page, "je peux payer en 2 fois ?")
        check("échelonné configuré, panier sous le minimum : réponse honnête avec le seuil", "20 000" in recent_replies(page) and "18 500" in recent_replies(page))
        click_button(page, "Noir")
        click_button(page, "M")
        check("le bouton « Ajouter un autre article » est proposé", "Ajouter un autre article" in buttons(page))
        send(page, "je veux aussi le sac Lune")
        check("« je veux aussi le sac Lune » bascule sur le sac (intro du sac)", "Sac à main Lune" in last_reply(page) or "Sac à main Lune" in txt(page.inner_text("#chat")))
        check("le sac pose ses propres questions (couleur)", "Bordeaux" in buttons(page))
        send(page, "je peux payer en 2 fois ?")
        check("échelonné, panier au-dessus du minimum : oui avec le calcul de l'avance", "50 % d'avance" in recent_replies(page) and "17 750" in recent_replies(page))
        click_button(page, "Bordeaux")
        check("récapitulatif panier annoncé avant le nom", "Votre panier" in txt(page.inner_text("#chat")) and "35 500" in txt(page.inner_text("#chat")))
        page.locator("#suggestions button").first.click()  # un nom
        page.wait_for_timeout(150)
        click_button(page, "Livraison à domicile")
        click_button(page, "Moov Money")
        chat = txt(page.inner_text("#chat"))
        check("commande à deux lignes avec le total + livraison", "Robe satin beige · Noir · Taille M" in chat and "Sac à main Lune · Bordeaux" in chat and "36 500 FCFA (livraison incluse)" in chat)
        page.click('[data-view="catalog"]')
        check("le stock de la robe est décrémenté (2 -> 1)", "1 en stock" in txt(page.inner_text("#home-products, #catalog-products")) or "1 en stock" in txt(page.inner_text("body")))
        page.click('[data-view="orders"]')
        check("la commande apparaît avec ses deux articles", "Sac à main Lune" in page.inner_text("#orders-list-full") and "Robe satin beige" in page.inner_text("#orders-list-full"))
        with page.expect_download() as download_info:
            page.click("#export-orders-button")
        content = open(download_info.value.path(), encoding="utf-8-sig").read()
        check("export CSV des commandes : en-tête + ligne de la commande", content.startswith("\"Date\";\"Cliente\"") and "Sac à main Lune" in content)

        # --- stock insuffisant : quantité ajustée, jamais négative ---
        page.click('[data-view="catalog"]')
        page.locator(".catalog-item", has_text="Robe satin beige").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(200)
        send(page, "j'en veux 3")
        click_button(page, "Beige")
        click_button(page, "S")
        page.locator("#suggestions button").first.click()
        page.wait_for_timeout(150)
        click_button(page, "Retrait en boutique")
        click_button(page, "Wave")
        chat = txt(page.inner_text("#chat"))
        check("stock insuffisant : Ọjà le dit et ajuste la quantité", "il en reste 1" in chat and "18 500 FCFA (retrait" in chat)
        page.click('[data-view="catalog"]')
        check("le stock passe en rupture, pas en négatif", "Rupture de stock" in page.inner_text("#catalog-products"))
        browser.close()

        # ============================================================
        # PARTIE 2 — Photos par variante
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        seed(page, [ROBE], ["Vêtements"])
        page.click('[data-view="catalog"]')
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        options = page.locator("#product-photo-variant-1 option").all_inner_texts()
        check("le formulaire propose les couleurs du produit pour chaque photo", "Beige" in options and "Noir" in options)
        make_png("v1.png", (255, 0, 0))
        page.set_input_files("#product-photo-1", "v1.png")
        page.wait_for_selector("#photo-preview-1 img")
        page.select_option("#product-photo-variant-1", "Noir")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.locator(".catalog-item", has_text="Robe satin beige").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(200)
        images_before = page.locator(".bubble-image.outgoing img").count()
        click_button(page, "Beige")
        check("choisir Beige n'envoie pas la photo rattachée à Noir", page.locator(".bubble-image.outgoing img").count() == images_before)
        page.click('[data-view="catalog"]')
        page.locator(".catalog-item", has_text="Robe satin beige").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(200)
        click_button(page, "Noir")
        check("choisir Noir envoie automatiquement la photo de cette couleur", page.locator(".bubble-image.outgoing img").count() == images_before + 1 and "en Noir" in txt(page.inner_text("#chat")))
        browser.close()

        # ============================================================
        # PARTIE 3 — Assistant de secours (Ollama simulé) et réglages
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        check("bannière « premier article » visible tant que le catalogue est celui de démo", page.is_visible("#first-step"))
        page.click("#first-step-dismiss")
        check("« Plus tard » masque la bannière", not page.is_visible("#first-step"))

        # Assistant désactivé : message inconnu -> transfert
        send(page, "ça se lave en machine ?")
        check("assistant désactivé : message inconnu -> transfert", "transmets" in last_reply(page).lower())

        # Activer Ollama et simuler ses réponses
        page.click("#settings-button")
        page.select_option("#assistant-provider", "ollama")
        page.fill("#assistant-model", "llama3.2")
        page.dispatch_event("#assistant-model", "change")
        check("les champs Ollama apparaissent quand le mode est activé", page.is_visible("#assistant-fields"))

        calls = []

        def handle(route):
            body = json.loads(route.request.post_data or "{}")
            calls.append(body)
            prompt = body.get("prompt", "").split("NOUVEAU MESSAGE DE LA CLIENTE")[-1]
            if "lave" in prompt:
                answer = {"answer": "", "confident": False}
            elif "12 000" in prompt:
                answer = {"answer": "Oui, elle est à 12 000 FCFA 🌷", "confident": True}
            else:
                answer = {"answer": "Non 🌷 Le satin se froisse peu, il suffit de le suspendre.", "confident": True}
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"response": json.dumps(answer)}))

        page.route("**/api/generate", handle)
        page.route("**/api/tags", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"models": [{"name": "llama3.2:latest"}]})))
        page.click("#assistant-test-button")
        page.wait_for_timeout(300)
        check("« Tester la connexion » confirme le modèle disponible", "Connecté" in page.inner_text("#assistant-status") and "disponible" in page.inner_text("#assistant-status"))
        page.click(".close-settings-modal")

        send(page, "ça se lave en machine ?")
        page.wait_for_timeout(400)
        check("l'assistant est appelé avec le catalogue dans le prompt", len(calls) >= 1 and "Robe satin beige" in calls[-1]["prompt"] and "18500" in calls[-1]["prompt"])
        check("modèle pas sûr -> transfert quand même (pas d'invention)", "transmets" in last_reply(page).lower())
        send(page, "elle se froisse vite ?")
        page.wait_for_timeout(400)
        check("modèle sûr -> sa réponse est affichée, marquée « assistant »", "satin" in last_reply(page).lower() and page.locator(".assistant-tag").count() == 1)
        send(page, "vous la mettez à 12 000 ?")
        page.wait_for_timeout(400)
        check("garde-fou : un montant absent des données est refusé -> transfert", "transmets" in last_reply(page).lower())

        page.click("#settings-button")
        page.check("#sound-toggle")
        page.click(".close-settings-modal")
        page.reload()
        page.wait_for_timeout(200)
        page.click("#settings-button")
        check("le réglage du son persiste", page.is_checked("#sound-toggle"))
        browser.close()

    print(f"\n{passed}/{passed + failed} tests passés")


if __name__ == "__main__":
    server = subprocess.Popen([sys.executable, "-m", "http.server", "8968"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        run()
    finally:
        server.terminate()
    if failed:
        raise SystemExit(1)
