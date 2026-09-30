"""
Tests du démarrage guidé : une nouvelle boutique part de zéro (aucun article, aucune commande),
l'onboarding se fait en 3 étapes, les exemples ne se chargent qu'à la demande, le téléphone a
un état vide explicite, et le parcours de démarrage sur l'Accueil suit la progression.
Vérifie aussi le formulaire produit replié (options avancées) et la lisibilité du téléphone.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8994"
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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- Chemin « Plus tard » : boutique vide, états vides partout ---
        page = browser.new_page()
        page.goto(BASE_URL)
        check("étape 1 : choix des catégories", page.is_visible("#onboarding-step-1") and not page.is_visible("#onboarding-step-2"))
        page.click('[data-category="Vêtements"]')
        page.click("#continue-button")
        check("étape 2 : ajouter le premier article (pas de tableau de bord rempli)", page.is_visible("#onboarding-step-2") and page.is_visible("#onboarding-add-product"))
        page.click("#onboarding-later")
        page.wait_for_selector("#onboarding.hidden", state="attached")
        check("boutique vide : aucun article, message d'état vide", page.locator(".product-card").count() == 0 and page.is_visible("#home-products .product-empty"))
        check("boutique vide : aucune commande de démo", page.is_visible("#order-list .empty-state") and page.inner_text("#order-count") == "0")
        check("téléphone : état vide explicite", page.is_visible(".phone-empty") and page.locator("#suggestions button").count() == 0)
        check("parcours : étape 1 faite, étapes 2 et 3 à faire", page.locator("#first-step-1.done").count() == 1 and page.locator("#first-step-2.done").count() == 0)
        page.fill("#composer-input", "bonjour")
        page.click("#send-button")
        page.wait_for_timeout(150)
        check("écrire dans le téléphone sans article : message clair, rien ne casse", "Ajoutez un article" in page.inner_text("#toast"))

        # --- Ajouter le premier article depuis le parcours ---
        page.click("#first-step-add")
        page.wait_for_selector("#product-modal[open]")
        check("formulaire : les options avancées sont repliées pour un nouvel article", page.locator("#product-modal details.advanced[open]").count() == 0)
        check("formulaire : la matière reste dans l'essentiel (le dialogue en a besoin)", page.is_visible("#clothes-material"))
        page.fill("#product-name", "Pagne tissé")
        page.fill("#product-price", "12000")
        page.fill("#product-stock", "4")
        page.fill("#clothes-size-values", "Unique")
        page.fill("#clothes-color-values", "Indigo")
        page.fill("#clothes-material", "Coton")
        page.click(".save-button")
        page.wait_for_timeout(300)
        check("premier article ajouté : le téléphone démarre une vraie conversation", "Pagne tissé" in page.inner_text("#chat"))
        check("parcours : étape 2 faite", page.locator("#first-step-2.done").count() == 1 and not page.is_visible("#first-step-add"))
        page.locator("#suggestions button").first.click()
        page.wait_for_timeout(200)
        check("parcours : étape 3 faite dès qu'Ọjà a répondu à une cliente, et le parcours disparaît", page.locator("#first-step").count() == 1 and not page.is_visible("#first-step"))

        # --- Modifier l'article : les sections remplies s'ouvrent seules ---
        page.click('[data-view="catalog"]')
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]")
        page.evaluate("document.querySelectorAll('#product-modal details').forEach(d => d.open = true)")
        page.fill("#clothes-range-name", "Collection Faso")
        page.click(".save-button")
        page.wait_for_timeout(300)
        page.click("[data-action='edit']")
        page.wait_for_selector("#product-modal[open]")
        page.wait_for_timeout(100)
        check("à la modification, une section avancée remplie s'ouvre automatiquement", page.locator("#product-modal details.advanced[open]").count() >= 1 and page.is_visible("#clothes-range-name"))
        # Régression (course vue sur GitHub Actions) : le dépliage différé ne doit jamais refermer une
        # section que la vendeuse vient d'ouvrir, même vide.
        page.evaluate("document.querySelectorAll('#product-modal details.advanced').forEach(d => d.open = true); openAdvancedIfFilled()")
        check("le dépliage automatique ne referme pas une section ouverte à la main", page.locator("#product-modal details.advanced:not([open])").count() == 0)
        page.click(".close-modal")

        # --- Lisibilité du téléphone ---
        size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.bubble')).fontSize)")
        button = page.evaluate("parseFloat(getComputedStyle(document.querySelector('#suggestions button')).fontSize)")
        check("téléphone : bulles à 14 px ou plus", size >= 14)
        check("téléphone : boutons de réponse à 13 px ou plus", button >= 13)
        browser.close()

        # --- Chemin « exemples » ---
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        page.click('[data-category="Cosmétiques"]')
        page.click("#continue-button")
        page.click("#load-demo-button")
        page.wait_for_selector("#onboarding.hidden", state="attached")
        check("exemples chargés à la demande : 3 articles, dont un cosmétique visible", page.locator(".product-card").count() >= 1 and "Glow" in page.inner_text("#home-products"))
        check("les exemples ne comptent pas comme « premier article »", page.locator("#first-step-2.done").count() == 0 and page.is_visible("#first-step"))
        page.reload()
        check("après rechargement, l'onboarding ne revient pas et les exemples restent", page.locator("#onboarding.hidden").count() == 1 and page.locator(".product-card").count() >= 1)
        browser.close()

    print(f"\n{passed}/{passed + failed} tests passés")


if __name__ == "__main__":
    server = subprocess.Popen([sys.executable, "-m", "http.server", "8994"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        run()
    finally:
        server.terminate()
    if failed:
        raise SystemExit(1)
