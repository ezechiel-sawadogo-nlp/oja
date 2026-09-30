"""
Tests de deux petits chantiers traités ensemble : "Logo boutique" (nouveau champ upload dans le
modal Infos boutique, distinct de la photo perso de la vendeuse) et "Galerie/zoom médias"
(visionneuse plein écran au clic sur une photo du chat, avec navigation entre toutes les photos
de la conversation en cours — flèches boutons, clavier, fermeture par clic sur le fond ou Echap ;
volontairement limitée aux photos, les vidéos gardent leurs contrôles natifs <video controls>).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8850"
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
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)

        # ============================================================
        # PARTIE 1 — Logo boutique
        # ============================================================

        # --- 1. Le champ logo existe, distinct de la photo perso, vide par défaut ---
        page.click("#profile-button")
        check("le champ logo boutique existe dans le modal",
              page.locator("#profile-logo-input").count() == 1)
        check("le champ logo est bien un input distinct du champ photo perso",
              page.get_attribute("#profile-logo-input", "id") != page.get_attribute("#profile-photo-input", "id"))
        check("aperçu logo affiche 'Aucun logo' tant qu'aucun logo n'est uploadé",
              page.inner_text("#profile-logo-preview").strip() == "Aucun logo")

        # --- 2. Upload du logo : l'aperçu bascule sur une image, indépendamment de la photo perso ---
        make_png("logo_test.png", (10, 120, 200))
        page.set_input_files("#profile-logo-input", "logo_test.png")
        page.wait_for_selector("#profile-logo-preview img")
        check("aperçu logo bascule sur une image après upload",
              page.locator("#profile-logo-preview img").count() == 1)
        check("l'aperçu photo perso reste sur les initiales (pas affecté par l'upload du logo)",
              page.locator("#profile-photo-preview img").count() == 0)
        page.click("#profile-modal .save-button")
        page.wait_for_timeout(200)

        # --- 3. Persistance du logo après reload, indépendante de la photo perso ---
        page.reload()
        page.click("#profile-button")
        page.wait_for_selector("#profile-logo-preview img")
        check("logo persiste après reload",
              page.locator("#profile-logo-preview img").count() == 1)
        page.click(".close-profile-modal")

        # ============================================================
        # PARTIE 2 — Galerie / zoom médias
        # ============================================================

        # --- 4. Sans média dans le chat, la visionneuse n'est pas encore ouverte ---
        check("la visionneuse est fermée au départ",
              not page.is_visible("#media-viewer"))

        # --- 5. Upload de 3 photos produit pour tester la navigation ---
        page.click('[data-view="catalog"]')
        page.wait_for_selector("[data-action='edit']")
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        make_png("g1.png", (255, 0, 0))
        make_png("g2.png", (0, 255, 0))
        make_png("g3.png", (0, 0, 255))
        page.set_input_files("#product-photo-1", "g1.png")
        page.wait_for_selector("#photo-preview-1 img")
        page.set_input_files("#product-photo-2", "g2.png")
        page.wait_for_selector("#photo-preview-2 img")
        page.set_input_files("#product-photo-3", "g3.png")
        page.wait_for_selector("#photo-preview-3 img")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.click('[data-view="home"]')

        # --- 6. Clic sur une photo du chat ouvre la visionneuse avec le bon compteur ---
        send(page, "vous avez d'autres photos ?")
        page.wait_for_timeout(500)
        check("3 photos zoomables sont présentes dans le chat",
              page.locator(".bubble-image.outgoing img.zoomable").count() == 3)
        page.locator(".bubble-image.outgoing img.zoomable").first.click()
        page.wait_for_timeout(200)
        check("la visionneuse s'ouvre au clic sur une photo",
              page.is_visible("#media-viewer"))
        check("le compteur affiche 1 / 3",
              page.inner_text("#media-viewer-count").strip() == "1 / 3")

        # --- 7. Navigation via les boutons flèches ---
        src_before = page.get_attribute("#media-viewer-image", "src")
        page.click("#media-viewer-next")
        page.wait_for_timeout(100)
        check("le compteur avance à 2 / 3 après clic sur suivant",
              page.inner_text("#media-viewer-count").strip() == "2 / 3")
        check("l'image affichée change après navigation",
              page.get_attribute("#media-viewer-image", "src") != src_before)
        page.click("#media-viewer-prev")
        page.wait_for_timeout(100)
        check("le compteur revient à 1 / 3 après clic sur précédent",
              page.inner_text("#media-viewer-count").strip() == "1 / 3")

        # --- 8. Navigation au clavier, avec boucle circulaire ---
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(100)
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(100)
        check("navigation clavier (flèche droite x2) atteint bien 3 / 3",
              page.inner_text("#media-viewer-count").strip() == "3 / 3")
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(100)
        check("la navigation boucle : après la dernière photo, retour à 1 / 3",
              page.inner_text("#media-viewer-count").strip() == "1 / 3")

        # --- 9. Fermeture par clic sur le fond (backdrop) ---
        page.mouse.click(10, 10)
        page.wait_for_timeout(200)
        check("clic sur le fond ferme la visionneuse",
              not page.is_visible("#media-viewer"))

        # --- 10. Fermeture par Échap ---
        page.locator(".bubble-image.outgoing img.zoomable").first.click()
        page.wait_for_timeout(200)
        check("visionneuse ré-ouverte pour tester Échap",
              page.is_visible("#media-viewer"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        check("Échap ferme la visionneuse",
              not page.is_visible("#media-viewer"))

        # --- 11. Fermeture par le bouton × ---
        page.locator(".bubble-image.outgoing img.zoomable").first.click()
        page.wait_for_timeout(200)
        page.click("#media-viewer-close")
        page.wait_for_timeout(200)
        check("le bouton × ferme la visionneuse",
              not page.is_visible("#media-viewer"))

        # --- 12. Une seule photo dans le chat : pas de flèches ni de compteur (rien à parcourir) ---
        # Important : on passe par "Ajouter un produit" (formulaire vraiment neuf, form.reset()
        # + resetMediaPreviews()) et pas par l'édition du produit existant — celui-ci garde
        # volontairement ses 3 photos déjà uploadées plus haut dans ce test (comportement voulu
        # du chantier "Médias multiples", pas un bug : "préservation des médias non remplacés
        # en édition"). Réutiliser le formulaire d'édition donnerait donc 3 photos, pas 1.
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        page.click('[data-view="catalog"]')
        page.click('.primary-button[data-action="Ajouter un produit"]')
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        page.fill("#product-name", "Article test galerie")
        page.fill("#product-price", "5000")
        page.fill("#product-stock", "3")
        page.fill("#clothes-size-values", "M")
        page.fill("#clothes-color-values", "Jaune")
        page.fill("#clothes-material", "Coton")
        make_png("single.png", (200, 200, 0))
        page.set_input_files("#product-photo-1", "single.png")
        page.wait_for_selector("#photo-preview-1 img")
        check("le nouveau produit part bien sans 2e/3e photo héritée",
              "Aucune photo" in page.inner_text("#photo-preview-2") and "Aucune photo" in page.inner_text("#photo-preview-3"))
        page.click(".save-button")
        page.wait_for_timeout(300)
        # le nouveau produit est visible dans le catalogue ; on clique son bouton "Simuler une
        # cliente" pour ouvrir une conversation le concernant spécifiquement (pas via l'accueil,
        # qui affiche seulement les 3 premiers produits et pourrait ne pas inclure celui-ci).
        page.locator(".catalog-item", has_text="Article test galerie").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(300)
        send(page, "vous avez d'autres photos ?")
        page.wait_for_timeout(500)
        check("une seule photo zoomable est présente dans le chat",
              page.locator(".bubble-image.outgoing img.zoomable").count() == 1)
        page.locator(".bubble-image.outgoing img.zoomable").first.click()
        page.wait_for_timeout(200)
        check("avec une seule photo, aucun compteur n'est affiché",
              page.inner_text("#media-viewer-count").strip() == "")
        check("avec une seule photo, les flèches de navigation sont cachées",
              not page.is_visible("#media-viewer-prev") and not page.is_visible("#media-viewer-next"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        # --- 13. Non-régression : le zoom ne s'applique pas aux vidéos (contrôles natifs préservés) ---
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        page.click('[data-view="catalog"]')
        page.wait_for_selector("[data-action='edit']")
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        with open("fake.mp4", "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32)
        page.set_input_files("#product-video-file", "fake.mp4")
        page.wait_for_function("document.querySelector('#video-preview').textContent.includes('fake.mp4')")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.click('[data-view="home"]')
        send(page, "vous avez une vidéo ?")
        page.wait_for_timeout(500)
        check("la vidéo envoyée n'a pas la classe zoomable (contrôles natifs préservés, pas de conflit)",
              page.locator(".bubble-image.outgoing video.zoomable").count() == 0)

        # --- 14. Non-régression rapide : nav + modal profil + modal réglages toujours fonctionnels ---
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="home"]')
        page.click("#profile-button")
        check("modal profil s'ouvre toujours", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")
        page.click("#settings-button")
        check("modal réglages s'ouvre toujours", page.is_visible("#settings-modal"))
        page.click(".close-settings-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8850"],
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
