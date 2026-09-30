"""
Tests du chantier "Registre de langue" : 3 nouvelles règles de conversation libre (horaires,
livraison/délais, merci), lisant les nouveaux champs du profil boutique (horaires, délai
livraison, zone livraison, tarif livraison), plus l'ajustement du flux panier qui en découle
(bouton "Livraison à domicile" retiré si le profil livraison est incomplet, montant calculé
sans frais pour un retrait en boutique).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8810"
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


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")


def fill_profile_delivery(page, hours="", delay="", zone="", fee=""):
    """Ouvre le modal Infos boutique, remplit les champs horaires/livraison donnés (vide = inchangé), sauvegarde."""
    page.click("#profile-button")
    if hours:
        page.fill("#profile-hours-input", hours)
    if delay:
        page.fill("#profile-delivery-delay-input", delay)
    if zone:
        page.fill("#profile-delivery-zone-input", zone)
    if fee:
        page.fill("#profile-delivery-fee-input", fee)
    page.click("#profile-modal .save-button")
    page.wait_for_timeout(200)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — profil vide au départ : tout doit rester honnête
        # ============================================================
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)

        # --- 1. Horaires non renseignées : transfert honnête ---
        send(page, "vous êtes ouverts jusqu'à quelle heure ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("horaires vides -> transfert honnête (pas d'horaire inventé)",
              "transmets" in last_reply.lower() or "pas encore" in last_reply.lower())

        # --- 2. Livraison non renseignée : transfert honnête ---
        send(page, "vous livrez en combien de temps ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("livraison vide -> transfert honnête (pas de zone/tarif inventé)",
              "transmets" in last_reply.lower())

        # --- 3. Merci : accusé de réception, la conversation continue (pas de fermeture) ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "merci beaucoup")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("merci -> réponse 'je vous en prie'",
              "je vous en prie" in last_reply.lower())
        check("après merci, le champ de saisie reste actif (conversation non fermée)",
              page.is_enabled("#composer-input"))

        # --- 4. Flux panier : sans profil livraison, seul le retrait est proposé ---
        page.click('[data-view="home"]')
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        page.click("#suggestions button >> nth=0")  # ouvre une conversation scriptée standard
        page.wait_for_timeout(200)
        # avance jusqu'à la question livraison/retrait via les boutons de choix rapides
        for _ in range(6):
            if page.locator("text=Livraison à domicile").count() or page.locator("text=Retrait en boutique").count():
                break
            buttons = page.locator("#suggestions button")
            if buttons.count() == 0:
                break
            buttons.first.click()
            page.wait_for_timeout(200)
        check("sans profil livraison, le bouton 'Livraison à domicile' n'apparaît pas",
              page.locator("#suggestions button", has_text="Livraison à domicile").count() == 0)
        check("sans profil livraison, 'Retrait en boutique' reste proposé",
              page.locator("#suggestions button", has_text="Retrait en boutique").count() >= 1)

        # ============================================================
        # PARTIE 2 — profil rempli : les 3 règles doivent utiliser les vraies valeurs
        # ============================================================
        fill_profile_delivery(page, hours="Lun-Sam, 9h-19h", delay="2-3 jours", zone="Ouagadougou", fee="1500")

        # --- 5. Horaires renseignées : réponse avec la vraie valeur du profil ---
        page.click('[data-view="home"]')
        send(page, "vos horaires d'ouverture svp")
        # La réponse, puis éventuellement la question de la commande reposée (reprise).
        last_reply = " ".join(page.locator(".bubble.outgoing").all_inner_texts()[-2:])
        check("horaires renseignées -> réponse contient la vraie valeur (Lun-Sam, 9h-19h)",
              "9h-19h" in last_reply)

        # --- 6. Livraison renseignée (zone + tarif + délai) : réponse complète ---
        send(page, "c'est quoi le délai de livraison ?")
        last_reply = " ".join(page.locator(".bubble.outgoing").all_inner_texts()[-2:])
        check("livraison renseignée -> mentionne la zone (Ouagadougou)",
              "Ouagadougou" in last_reply)
        check("livraison renseignée -> mentionne le tarif (1 500 FCFA)",
              "1" in last_reply and "500" in last_reply)
        check("livraison renseignée -> mentionne le délai (2-3 jours)",
              "2-3 jours" in last_reply)

        # --- 7. Flux panier : avec profil complet, la livraison à domicile redevient disponible ---
        page.click('[data-view="home"]')
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        # Nouvelle conversation (la précédente a pu avancer : Ọjà reprend la commande après une question).
        page.locator("[data-chat-product='robe']").first.click()
        page.wait_for_timeout(200)
        for _ in range(8):
            if page.locator("#suggestions button", has_text="Livraison à domicile").count():
                break
            buttons = page.locator("#suggestions button")
            if buttons.count() == 0:
                break
            buttons.first.click()
            page.wait_for_timeout(200)
        check("avec profil livraison complet, 'Livraison à domicile' redevient proposée",
              page.locator("#suggestions button", has_text="Livraison à domicile").count() >= 1)

        # --- 8. Choisir la livraison affiche le vrai tarif du profil (pas 1000 FCFA en dur) ---
        page.locator("#suggestions button", has_text="Livraison à domicile").first.click()
        page.wait_for_timeout(200)
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("message livraison utilise le tarif du profil (1 500 FCFA), pas l'ancien 1000 FCFA en dur",
              "500" in last_reply and "1 000" not in last_reply)

        # --- 9. Non-régression rapide : nav + modal profil toujours fonctionnels ---
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="catalog"]')
        check("nav vers Catalogue fonctionne toujours", page.is_visible("#catalog-view"))
        page.click('[data-view="home"]')
        page.click("#profile-button")
        check("modal profil s'ouvre toujours", page.is_visible("#profile-modal"))
        check("les 4 nouveaux champs sont bien dans le modal",
              page.locator("#profile-hours-input, #profile-delivery-delay-input, #profile-delivery-zone-input, #profile-delivery-fee-input").count() == 4)
        page.click(".close-profile-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8810"],
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
