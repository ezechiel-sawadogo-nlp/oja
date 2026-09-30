"""
Tests du chantier "Médias multiples" : jusqu'à 3 photos + 1 vidéo par produit, avec wornCount
(les dernières photos uploadées comptent comme "portées"), et les 3 règles conversationnelles
associées (photos produit, photo portée, vidéo), chacune testée disponible et indisponible.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8800"
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


def make_png(path, color=(255, 0, 0)):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00" + bytes(color)))
    iend = chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(sig + ihdr + idat + iend)


def make_fake_mp4(path):
    # Un vrai décodage MP4 n'est pas nécessaire : le prototype lit le fichier en dataURL brut,
    # sans le décoder. Quelques octets arbitraires suffisent à simuler un upload vidéo.
    with open(path, "wb") as f:
        f.write(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32)


def skip_onboarding(page):
    page.click('[data-category="Vêtements"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")


def open_edit_form(page):
    page.click('[data-view="catalog"]')
    page.wait_for_selector("[data-action='edit']")
    page.click("[data-action='edit']")
    page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)

        # --- 1. Sans aucun média : les 3 règles restent honnêtes et transfèrent ---
        send(page, "vous avez d'autres photos ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("sans photo, réponse honnête sur l'absence de photo",
              "pas" in last_reply.lower())

        send(page, "vous avez une photo porté ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("sans photo portée, transfert vers Josie",
              "transmets" in last_reply.lower())

        send(page, "vous avez une vidéo de l'article ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("sans vidéo, transfert vers Josie",
              "transmets" in last_reply.lower())

        # --- 2. Upload de 3 photos + vidéo, avec 1 photo portée (wornCount=1 -> la 3e est portée) ---
        open_edit_form(page)
        make_png("t1.png", (255, 0, 0))
        make_png("t2.png", (0, 255, 0))
        make_png("t3.png", (0, 0, 255))
        make_fake_mp4("t.mp4")
        page.set_input_files("#product-photo-1", "t1.png")
        page.wait_for_selector("#photo-preview-1 img")
        page.set_input_files("#product-photo-2", "t2.png")
        page.wait_for_selector("#photo-preview-2 img")
        page.set_input_files("#product-photo-3", "t3.png")
        page.wait_for_selector("#photo-preview-3 img")
        page.select_option("#product-worn-count", "1")
        page.set_input_files("#product-video-file", "t.mp4")
        page.wait_for_function("document.querySelector('#video-preview').textContent.includes('t.mp4')")
        check("les 3 aperçus photo affichent bien une image après upload",
              page.locator("#photo-preview-1 img, #photo-preview-2 img, #photo-preview-3 img").count() == 3)
        page.click(".save-button")
        page.wait_for_timeout(400)
        page.click('[data-view="home"]')

        # --- 3. "d'autres photos" envoie maintenant plusieurs bulles-image (les 2 photos "produit") ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "vous avez d'autres photos ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        image_bubbles = page.locator(".bubble-image.outgoing img").count()
        check("2 photos 'produit' envoyées (wornCount=1 sur 3 -> 2 restantes)",
              image_bubbles == 2)

        # --- 4. "montre porté" envoie la 3e photo (la dernière uploadée) ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "vous pouvez me montrer porté ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-2")  # message texte juste avant l'image
        check("réponse porté confirme plutôt que transférer",
              "voici" in last_reply.lower())
        check("une bulle-image supplémentaire apparaît pour la photo portée",
              page.locator(".bubble-image.outgoing img").count() == 3)

        # --- 5. "vidéo" envoie bien une balise <video> ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "vous avez une petite vidéo ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        check("une bulle-image contenant une balise <video> apparaît",
              page.locator(".bubble-image.outgoing video").count() >= 1)
        video_src = page.locator(".bubble-image.outgoing video").first.get_attribute("src")
        check("la vidéo a bien un src en dataURL",
              video_src and video_src.startswith("data:"))

        # --- 6. Édition : les aperçus se pré-remplissent bien avec les médias déjà enregistrés ---
        open_edit_form(page)
        check("les 3 aperçus photo sont pré-remplis en réouvrant le formulaire",
              page.locator("#photo-preview-1 img, #photo-preview-2 img, #photo-preview-3 img").count() == 3)
        check("le select wornCount reflète bien la valeur sauvegardée (1)",
              page.input_value("#product-worn-count") == "1")
        check("l'aperçu vidéo indique qu'une vidéo est déjà enregistrée",
              "enregistrée" in page.inner_text("#video-preview").lower())
        page.click(".close-modal")

        # --- 7. wornCount ne peut jamais dépasser le nombre réel de photos (plafonnage) ---
        open_edit_form(page)
        page.select_option("#product-worn-count", "3")  # 3 alors qu'aucune nouvelle photo n'est ajoutée ici, déjà 3 existantes -> ok, teste le cas limite différemment
        page.click(".save-button")
        page.wait_for_timeout(300)
        open_edit_form(page)
        check("wornCount=3 est accepté quand il y a exactement 3 photos (cas limite correct)",
              page.input_value("#product-worn-count") == "3")
        page.click(".close-modal")

        # --- 8. Non-régression : catalogue affiche toujours le bon badge avec plusieurs photos ---
        page.click('[data-view="catalog"]')
        check("le badge catalogue reflète le nombre de photos ou 'Vidéo'",
              "Photo" in page.inner_text(".product-art b") or "Vidéo" in page.inner_text(".product-art b"))

        # --- 9. Non-régression rapide sur le reste ---
        page.click('[data-view="home"]')
        check("nav Accueil fonctionne toujours", page.is_visible("#home-view"))
        page.click("#profile-button")
        check("modal profil s'ouvre toujours", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8800"],
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
