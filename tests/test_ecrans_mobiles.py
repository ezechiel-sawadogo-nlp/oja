"""
Tests du chantier "Écrans mobiles" : passage de la maquette (5 écrans + Profil) au vrai code
responsive. Un seul jeu de fichiers adaptatif — pas de prototype mobile séparé. Le seuil mobile
est 620px (cohérent avec l'existant). Chaque section teste le comportement mobile puis vérifie
la non-régression du même point en desktop, sur des pages Playwright séparées pour éviter tout
état résiduel entre les deux tailles de viewport.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import struct
import subprocess
import time
import zlib
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8950"
MOBILE_VIEWPORT = {"width": 390, "height": 844}
DESKTOP_VIEWPORT = {"width": 1280, "height": 800}
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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — Fondation mobile : nav du bas, bascule de vues, menu profil
        # ============================================================
        page = browser.new_page(viewport=MOBILE_VIEWPORT)
        page.goto(BASE_URL)
        skip_onboarding(page)

        check("sidebar desktop cachée en mobile", not page.is_visible(".sidebar"))
        check("nav du bas visible en mobile", page.is_visible(".mobile-nav"))
        check("5 items dans la nav du bas", page.locator(".mobile-nav-item").count() == 5)
        check("phone-zone (Conversations) visible par défaut sur Accueil", page.is_visible(".phone-zone"))

        page.click('[data-mobile-view="conversations"]')
        page.wait_for_timeout(150)
        check("clic sur Conversations : phone-zone reste visible", page.is_visible(".phone-zone"))
        check("clic sur Conversations : home-view se cache", not page.is_visible("#home-view"))

        page.click('[data-mobile-view="home"]')
        page.wait_for_timeout(150)
        check("retour sur Accueil : home-view revient", page.is_visible("#home-view"))
        check("retour sur Accueil : phone-zone se cache", not page.is_visible(".phone-zone"))

        # Menu profil mobile : 3 entrées (Infos boutique / Registre de langue / Réglages)
        page.click("#mobile-profile-avatar")
        page.wait_for_timeout(150)
        check("menu profil mobile a 3 entrées", page.locator("#mobile-profile-menu button").count() == 3)
        page.click("#mobile-profile-open-info")
        page.wait_for_timeout(150)
        check("entrée 'Infos boutique' ouvre le modal profil existant", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")

        page.click("#mobile-profile-avatar")
        page.click("#mobile-profile-open-settings")
        page.wait_for_timeout(150)
        check("entrée 'Réglages' ouvre le modal réglages existant", page.is_visible("#settings-modal"))
        page.click(".close-settings-modal")

        page.click("#mobile-profile-avatar")
        page.click("#mobile-profile-open-language")
        page.wait_for_timeout(200)
        check("entrée 'Registre de langue' affiche un message honnête (pas de faux contenu)",
              "pas encore configuré" in page.inner_text("#toast"))

        # ============================================================
        # PARTIE 2 — Accueil mobile : 2 chiffres globaux, raccourci unique, non-régression
        # ============================================================
        page.click('[data-mobile-view="home"]')
        page.wait_for_timeout(150)
        check("summary-grid desktop (3 stats) caché en mobile", not page.is_visible(".summary-grid"))
        check("mobile-summary-grid (2 chiffres) visible en mobile", page.is_visible(".mobile-summary-grid"))
        check("un seul raccourci visible en mobile (pas les 3 desktop)",
              page.locator(".quick:visible").count() == 1)
        check("le chiffre 'En attente' est un nombre",
              page.inner_text("#mobile-pending-count").strip().isdigit())
        check("le chiffre 'Total aujourd'hui' contient FCFA",
              "FCFA" in page.inner_text("#mobile-today-total"))

        # ============================================================
        # PARTIE 3 — Commandes mobile : 2 stats + déplier, chips scrollables
        # ============================================================
        page.click('[data-mobile-view="orders"]')
        page.wait_for_timeout(150)
        check("2 stat-cards visibles par défaut (sur 4)", page.locator(".stat-card:visible").count() == 2)
        check("bouton 'voir plus' stats visible en mobile", page.is_visible("#orders-stats-toggle"))
        page.click("#orders-stats-toggle")
        page.wait_for_timeout(150)
        check("les 4 stat-cards sont visibles après clic sur 'voir plus'",
              page.locator(".stat-card:visible").count() == 4)
        page.click("#orders-stats-toggle")
        page.wait_for_timeout(150)
        check("re-clic sur le toggle réduit à nouveau à 2 stat-cards",
              page.locator(".stat-card:visible").count() == 2)
        status_wrap = page.evaluate("getComputedStyle(document.querySelector('#orders-status-tabs')).flexWrap")
        check("chips de statut ne wrap plus (scroll horizontal) en mobile", status_wrap == "nowrap")

        # ============================================================
        # PARTIE 4 — Catalogue mobile : FAB flottant, déclenche le formulaire d'ajout
        # ============================================================
        page.click('[data-mobile-view="catalog"]')
        page.wait_for_timeout(150)
        check("FAB catalogue visible en mobile", page.is_visible("#catalog-fab"))
        page.click("#catalog-fab")
        page.wait_for_timeout(150)
        check("clic sur le FAB ouvre le même formulaire d'ajout que le bouton desktop",
              page.is_visible("#product-modal[open]"))
        page.click(".close-modal")
        category_wrap = page.evaluate("getComputedStyle(document.querySelector('#catalog-category-tabs')).flexWrap")
        check("chips catégorie ne wrap plus (scroll horizontal) en mobile", category_wrap == "nowrap")

        # ============================================================
        # PARTIE 5 — Clients mobile : recherche fonctionnelle, filtre, message vide distinct
        # ============================================================
        page.click('[data-mobile-view="customers"]')
        page.wait_for_timeout(150)
        check("champ de recherche client visible", page.is_visible("#customers-search-input"))
        count_before_search = page.locator(".customer-card").count()
        page.fill("#customers-search-input", "Aïssata")
        page.wait_for_timeout(150)
        check("recherche par nom existant filtre correctement",
              page.locator(".customer-card").count() >= 1)
        page.fill("#customers-search-input", "Zzznonexistant123")
        page.wait_for_timeout(150)
        check("recherche sans résultat affiche un message distinct de l'état vide générique",
              "correspond à cette recherche" in page.inner_text(".empty-state"))
        page.fill("#customers-search-input", "")
        page.wait_for_timeout(150)
        check("vider la recherche restaure la liste complète",
              page.locator(".customer-card").count() == count_before_search)

        # ============================================================
        # PARTIE 6 — Non-régression desktop complète (nouvelle page, viewport large)
        # ============================================================
        desktop_page = browser.new_page(viewport=DESKTOP_VIEWPORT)
        desktop_page.goto(BASE_URL)
        skip_onboarding(desktop_page)

        check("[desktop] sidebar visible", desktop_page.is_visible(".sidebar"))
        check("[desktop] nav du bas mobile invisible", not desktop_page.is_visible(".mobile-nav"))
        check("[desktop] avatar profil mobile invisible", not desktop_page.is_visible(".mobile-profile"))
        check("[desktop] phone-zone (simulateur) visible en permanence", desktop_page.is_visible(".phone-zone"))

        desktop_page.click('[data-view="catalog"]')
        desktop_page.wait_for_timeout(150)
        check("[desktop] navigation sidebar classique fonctionne toujours",
              desktop_page.is_visible("#catalog-view"))
        check("[desktop] phone-zone reste visible même après navigation sidebar",
              desktop_page.is_visible(".phone-zone"))
        check("[desktop] FAB catalogue invisible", not desktop_page.is_visible("#catalog-fab"))

        desktop_page.click('[data-view="home"]')
        check("[desktop] summary-grid (3 stats) visible", desktop_page.is_visible(".summary-grid"))
        check("[desktop] mobile-summary-grid invisible", not desktop_page.is_visible(".mobile-summary-grid"))
        check("[desktop] les 3 raccourcis sont visibles (pas juste 1)",
              desktop_page.locator(".quick:visible").count() == 3)

        desktop_page.click('[data-view="orders"]')
        desktop_page.wait_for_timeout(150)
        check("[desktop] les 4 stat-cards sont visibles sans clic",
              desktop_page.locator(".stat-card:visible").count() == 4)
        check("[desktop] bouton 'voir plus' invisible", not desktop_page.is_visible("#orders-stats-toggle"))

        desktop_page.click('[data-view="customers"]')
        desktop_page.wait_for_timeout(150)
        check("[desktop] recherche client fonctionne aussi (amélioration partagée)",
              desktop_page.is_visible("#customers-search-input"))

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8950"],
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
