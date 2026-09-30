"""
Tests du chantier "Profil vendeuse" (avatar sidebar -> modal Infos boutique).
Lancé avec un serveur HTTP local pointant sur ce dossier (voir bas de fichier).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8765"
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
    """L'onboarding catégories s'affiche tant que localStorage est vide. On choisit Vêtements et on continue."""
    page.click('[data-category="Vêtements"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def make_png(path, color=(255, 0, 0)):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00" + bytes(color)))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + ihdr + idat + chunk(b"IEND", b""))


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- 1. État initial : valeurs par défaut affichées dans la sidebar ---
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        check("sidebar affiche le nom vendeuse par défaut (Josie K.)",
              page.inner_text("#profile-seller-name") == "Josie K.")
        check("sidebar affiche le nom boutique par défaut (Josie Style)",
              page.inner_text("#profile-shop-name") == "Josie Style")
        check("avatar affiche les initiales par défaut (JK)",
              page.inner_text("#profile-avatar").strip() == "JK")

        # --- 2. Ouverture du modal, pré-remplissage ---
        page.click("#profile-button")
        check("le modal profil s'ouvre", page.is_visible("#profile-modal"))
        check("champ nom boutique pré-rempli",
              page.input_value("#profile-shop-name-input") == "Josie Style")
        check("champ nom vendeuse pré-rempli",
              page.input_value("#profile-seller-name-input") == "Josie K.")
        check("champ contact vide par défaut",
              page.input_value("#profile-contact-input") == "")
        check("aperçu photo affiche les initiales tant qu'aucune photo",
              page.inner_text("#profile-photo-preview").strip() == "JK")

        # --- 3. Fermeture via Annuler ne doit rien sauvegarder ---
        page.fill("#profile-shop-name-input", "Ne pas sauvegarder ceci")
        page.click(".cancel-profile-button")
        check("modal fermé après Annuler", not page.is_visible("#profile-modal"))
        check("sidebar inchangée après Annuler",
              page.inner_text("#profile-shop-name") == "Josie Style")

        # --- 4. Modification complète + sauvegarde ---
        page.click("#profile-button")
        page.fill("#profile-shop-name-input", "Boutique Awa")
        page.fill("#profile-seller-name-input", "Awa Sawadogo")
        page.fill("#profile-contact-input", "awa@example.com")
        page.fill("#profile-description-input", "Prêt-à-porter et accessoires faits main.")
        page.click("#profile-modal .save-button")
        check("modal fermé après Enregistrer", not page.is_visible("#profile-modal"))
        check("sidebar reflète le nouveau nom boutique",
              page.inner_text("#profile-shop-name") == "Boutique Awa")
        check("sidebar reflète le nouveau nom vendeuse",
              page.inner_text("#profile-seller-name") == "Awa Sawadogo")
        check("avatar reflète les nouvelles initiales (AS)",
              page.inner_text("#profile-avatar").strip() == "AS")
        check("toast de confirmation affiché",
              "enregistrées" in page.inner_text("#toast"))

        # --- 5. Persistance après rechargement de page ---
        page.reload()
        check("nom boutique persiste après reload",
              page.inner_text("#profile-shop-name") == "Boutique Awa")
        check("nom vendeuse persiste après reload",
              page.inner_text("#profile-seller-name") == "Awa Sawadogo")
        page.click("#profile-button")
        check("description persiste après reload",
              page.input_value("#profile-description-input") == "Prêt-à-porter et accessoires faits main.")
        check("contact persiste après reload",
              page.input_value("#profile-contact-input") == "awa@example.com")
        page.click(".close-profile-modal")

        # --- 6. Champ obligatoire vidé : la validation HTML native bloque la soumission (comportement voulu) ---
        page.click("#profile-button")
        page.fill("#profile-shop-name-input", "")
        page.click("#profile-modal .save-button")
        check("le modal reste ouvert tant que le nom boutique est vide (validation native)",
              page.is_visible("#profile-modal"))
        check("sidebar jamais mise à jour avec un nom boutique vide",
              page.inner_text("#profile-shop-name").strip() != "")
        page.fill("#profile-shop-name-input", "Boutique Awa")
        page.click(".close-profile-modal")

        # --- 7. Upload photo : l'aperçu bascule sur une image ---
        page.click("#profile-button")
        make_png("test_pixel.png")
        page.set_input_files("#profile-photo-input", "test_pixel.png")
        page.wait_for_selector("#profile-photo-preview img")
        check("aperçu photo bascule sur une image après upload",
              page.locator("#profile-photo-preview img").count() == 1)
        page.click("#profile-modal .save-button")
        page.wait_for_selector("#profile-avatar img")
        check("avatar sidebar affiche l'image après sauvegarde",
              page.locator("#profile-avatar img").count() == 1)

        # --- 8. Photo persiste après reload ---
        page.reload()
        page.wait_for_selector("#profile-avatar img")
        check("photo persiste dans l'avatar sidebar après reload",
              page.locator("#profile-avatar img").count() == 1)
        page.click("#profile-button")
        page.wait_for_selector("#profile-photo-preview img")
        check("photo persiste dans l'aperçu du modal après reload",
              page.locator("#profile-photo-preview img").count() == 1)
        page.click(".close-profile-modal")

        # --- 9. Non-régression rapide : nav entre les 4 vues fonctionne toujours ---
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="catalog"]')
        check("nav vers Catalogue fonctionne toujours", page.is_visible("#catalog-view"))
        page.click('[data-view="customers"]')
        check("nav vers Clients fonctionne toujours", page.is_visible("#customers-view"))
        page.click('[data-view="home"]')
        check("retour vers Accueil fonctionne toujours", page.is_visible("#home-view"))
        check("le bouton profil reste accessible depuis n'importe quelle vue",
              page.is_visible("#profile-button"))

        # --- 10. Non-régression : le modal produit s'ouvre toujours normalement à côté du modal profil ---
        page.click('[data-action="Ajouter un produit"]')
        check("modal produit s'ouvre toujours (pas de conflit avec le nouveau modal)",
              page.is_visible("#product-modal"))
        page.click(".close-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8765"],
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
