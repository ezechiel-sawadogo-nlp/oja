"""
Tests du chantier "Réglages" : nouveau modal accessible depuis la sidebar (bouton distinct du
bouton profil), export des données en .json téléchargeable, réinitialisation complète avec
confirmation à deux temps (l'annulation ne doit rien effacer, la confirmation efface tout et
recharge la page — l'onboarding catégories doit alors réapparaître, preuve que oja-categories
a bien été effacé en plus des données produit/profil/commandes/escalades).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import json
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8820"
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
    page.click('[data-category="Vêtements"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — accès au modal, export, annulation du reset
        # ============================================================
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)

        # --- 1. Le bouton Réglages est distinct du bouton profil, et ouvre son propre modal ---
        check("le bouton Réglages existe et est distinct du bouton profil",
              page.locator("#settings-button").count() == 1)
        page.click("#settings-button")
        check("le modal Réglages s'ouvre", page.is_visible("#settings-modal"))
        check("le modal profil (Infos boutique) n'est pas ouvert en même temps",
              not page.is_visible("#profile-modal"))

        # --- 2. Export : déclenche un téléchargement .json contenant les 6 clés du prototype ---
        with page.expect_download() as dl_info:
            page.click("#export-data-button")
        download = dl_info.value
        check("l'export propose un nom de fichier .json",
              download.suggested_filename.endswith(".json"))
        export_path = download.path()
        with open(export_path, encoding="utf-8") as f:
            exported = json.load(f)
        expected_keys = {"oja-products", "oja-orders", "oja-profile", "oja-escalations", "oja-categories", "oja-theme"}
        check("le fichier exporté contient bien les 6 clés attendues",
              expected_keys.issubset(exported.keys()))
        check("oja-products contient les 3 articles d'exemple chargés à l'onboarding",
              isinstance(exported["oja-products"], list) and len(exported["oja-products"]) == 3)
        page.click(".close-settings-modal")

        # --- 2b. Après une vraie sauvegarde produit, l'export capture bien la donnée persistée ---
        page.click('[data-view="catalog"]')
        page.wait_for_selector("[data-action='edit']")
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]"); page.evaluate("document.querySelectorAll(\'#product-modal details\').forEach(d => d.open = true)")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.click('[data-view="home"]')
        page.click("#settings-button")
        with page.expect_download() as dl_info2:
            page.click("#export-data-button")
        with open(dl_info2.value.path(), encoding="utf-8") as f:
            exported2 = json.load(f)
        check("après une sauvegarde produit explicite, l'export contient bien les produits",
              exported2["oja-products"] is not None and len(exported2["oja-products"]) > 0)

        # --- 3. Réinitialisation : le clic initial affiche une confirmation, ne fait rien seul ---
        check("la zone de confirmation reset est cachée au départ",
              not page.is_visible("#reset-data-confirm"))
        page.click("#reset-data-button")
        check("cliquer sur 'Effacer toutes les données' affiche la confirmation",
              page.is_visible("#reset-data-confirm"))

        # --- 4. Annuler la confirmation ne doit RIEN effacer ---
        page.click("#reset-data-cancel")
        check("après Annuler, la confirmation se recache",
              not page.is_visible("#reset-data-confirm"))
        check("après Annuler, le modal Réglages reste ouvert",
              page.is_visible("#settings-modal"))
        page.click(".close-settings-modal")
        page.click("#profile-button")
        check("après Annuler du reset, les données du profil existent toujours (pas effacées)",
              page.input_value("#profile-shop-name-input") == "Josie Style")
        page.click(".close-profile-modal")

        # ============================================================
        # PARTIE 2 — réinitialisation confirmée : tout doit disparaître
        # ============================================================
        # On modifie d'abord le profil pour avoir quelque chose de non-défaut à effacer.
        page.click("#profile-button")
        page.fill("#profile-shop-name-input", "Boutique Avant Reset")
        page.click("#profile-modal .save-button")
        page.wait_for_timeout(200)
        check("le profil modifié est bien pris en compte avant le reset",
              page.inner_text("#profile-shop-name") == "Boutique Avant Reset")

        page.click("#settings-button")
        page.click("#reset-data-button")
        page.click("#reset-data-confirm-button")
        page.wait_for_load_state("networkidle")

        # --- 5. Après confirmation, la page recharge et l'onboarding catégories réapparaît ---
        check("après confirmation du reset, l'onboarding catégories réapparaît (oja-categories effacé)",
              page.is_visible("#onboarding"))

        # --- 6. Après reset + nouvel onboarding, le profil est bien revenu aux valeurs par défaut ---
        skip_onboarding(page)
        check("après reset, le profil est revenu à sa valeur par défaut (Josie Style)",
              page.inner_text("#profile-shop-name") == "Josie Style")

        # ============================================================
        # PARTIE 3 — non-régression
        # ============================================================
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="catalog"]')
        check("nav vers Catalogue fonctionne toujours", page.is_visible("#catalog-view"))
        page.click('[data-view="home"]')
        page.click("#profile-button")
        check("modal profil s'ouvre toujours normalement", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")
        page.click("#settings-button")
        check("modal réglages s'ouvre toujours normalement (deuxième ouverture)",
              page.is_visible("#settings-modal"))
        page.click(".close-settings-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8820"],
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
