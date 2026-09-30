"""
Tests du Bloc D : Ọjà envoie une photo du produit (mot-clé "photos d'autres clientes" quand
product.image existe), et le client envoie une photo depuis le simulateur (escalade automatique).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8790"
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


def make_test_png(path):
    width, height = 1, 1
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
    iend = chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(sig + ihdr + idat + iend)


def skip_onboarding(page):
    page.click('[data-category="Vêtements"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- 1. Sans image produit : "photos d'autres clientes" reste honnête, pas d'image envoyée ---
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        bubble_count_before = page.locator(".bubble").count()
        send(page, "tu as des photos d'autres clientes ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        check("sans image produit, aucune bulle-image n'est ajoutée",
              page.locator(".bubble-image.outgoing").count() == 0)
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("le message reste honnête sur l'absence de photo supplémentaire",
              "pas" in last_reply.lower())

        # --- 2. Avec une image produit : Ọjà envoie réellement l'image en bulle ---
        page.click('[data-view="catalog"]')
        page.wait_for_selector(".catalog-item, [data-action='edit']")
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        make_test_png("test_pixel.png")
        page.set_input_files("#product-photo-1", "test_pixel.png")
        page.wait_for_selector("#photo-preview-1 img")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.click('[data-view="home"]')
        bubble_count_before = page.locator(".bubble").count()
        send(page, "tu as des photos d'autres clientes ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        check("avec une image produit, une bulle-image outgoing apparaît",
              page.locator(".bubble-image.outgoing").count() >= 1)
        check("la bulle-image contient bien un <img> avec un dataURL",
              "data:image" in (page.locator(".bubble-image.outgoing img").first.get_attribute("src") or ""))

        # --- 3. Le client peut envoyer une photo : bouton + fonctionnel ---
        check("le bouton d'envoi de photo (composer-image) existe dans le DOM",
              page.locator("#composer-image").count() == 1)
        with page.expect_file_chooser() as fc_info:
            page.click(".composer-attach")
        check("cliquer sur + déclenche bien le sélecteur de fichier natif",
              fc_info.value is not None)

        # --- 4. Envoi effectif d'une photo côté client ---
        bubble_count_before = page.locator(".bubble").count()
        escalations_before = page.locator(".order.escalation").count()
        page.set_input_files("#composer-image", "test_pixel.png")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        check("la photo du client apparaît en bulle-image incoming",
              page.locator(".bubble-image.incoming").count() >= 1)
        check("un message générique d'escalade suit la photo (Ọjà ne réagit pas au contenu)",
              "transmets" in page.inner_text(".bubble.outgoing >> nth=-1").lower())

        # --- 5. L'envoi de photo déclenche bien une escalade (alerte Accueil) ---
        page.click('[data-view="home"]')
        check("une nouvelle alerte apparaît après l'envoi de la photo",
              page.locator(".order.escalation").count() > escalations_before)
        escalation_texts = page.locator(".order.escalation p").all_inner_texts()
        check("l'alerte affiche '📷 Photo envoyée' plutôt qu'un texte de message",
              any("Photo envoyée" in text for text in escalation_texts))

        # --- 6. Non-régression : le champ texte fonctionne toujours normalement à côté ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "et la livraison, comment ça marche ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        check("le champ texte fonctionne toujours normalement après l'ajout du bouton photo",
              page.locator(".bubble.incoming").last.inner_text().startswith("et la livraison"))

        # --- 7. Non-régression rapide : nav + modal profil toujours fonctionnels ---
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="home"]')
        page.click("#profile-button")
        check("modal profil s'ouvre toujours", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8790"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.8)
    try:
        run()
    finally:
        server.terminate()
    print(f"\n{passed}/{passed + failed} tests passés")
    if failed:
        raise SystemExit(1)
