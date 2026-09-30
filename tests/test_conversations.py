"""
Tests du chantier "Conversations libres" : champ de saisie fonctionnel, détection de
mots-clés (couleur, matière, photos clientes), escalade vers Josie (alerte Accueil + reprise).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8780"
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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- 1. Le champ de saisie est bien un vrai input, plus le div décoratif ---
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        check("le champ de saisie est un <input> fonctionnel",
              page.locator("#composer-input").count() == 1)
        check("l'input est vide au départ",
              page.input_value("#composer-input") == "")

        # --- 2. Envoi d'un message vide ne fait rien ---
        initial_bubble_count = page.locator(".bubble").count()
        page.click("#send-button")
        check("un message vide n'ajoute aucune bulle",
              page.locator(".bubble").count() == initial_bubble_count)

        # --- 3. Message libre standard : ajoute une bulle incoming avec le texte exact ---
        send(page, "Bonjour, je voudrais des infos")
        check("le message du client apparaît comme bulle incoming",
              "Bonjour, je voudrais des infos" in page.inner_text(".bubble.incoming >> nth=-1"))
        check("le champ se vide après envoi",
              page.input_value("#composer-input") == "")

        # --- 4. Mot-clé couleur NON disponible : Ọjà propose les couleurs réellement dispo ---
        bubble_count_before = page.locator(".bubble").count()
        send(page, "est-ce que ça existe en noir ?")
        page.wait_for_function(f"document.querySelectorAll('.bubble').length > {bubble_count_before}")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("réponse couleur mentionne une couleur disponible (Beige, la couleur du produit de démo)",
              "Beige" in last_reply or "beige" in last_reply)

        # --- 4b. Mot-clé couleur DISPONIBLE : Ọjà confirme au lieu de proposer une alternative ---
        send(page, "vous l'avez en beige ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("réponse couleur disponible confirme plutôt que proposer une alternative",
              "disponible" in last_reply.lower() and "oui" in last_reply.lower())

        # --- 5. Mot-clé matière : répond avec la vraie matière du produit (Satin pour la robe démo) ---
        send(page, "c'est en quelle matière ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("réponse matière mentionne la vraie matière (Satin)",
              "Satin" in last_reply or "satin" in last_reply)

        # --- 6. Mot-clé photos clientes : réponse honnête, pas d'invention ---
        send(page, "tu as des photos d'autres clientes ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("réponse photos clientes est honnête (pas de photos) et propose une alternative",
              "pas encore" in last_reply.lower() and "article" in last_reply.lower())

        # --- 7. Paiement échelonné : transfert silencieux vers Josie (pas de réponse inventée) ---
        page.click('[data-view="home"]')
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        send(page, "je peux payer en 2 fois ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("paiement échelonné déclenche le transfert (pas une fausse réponse oui/non)",
              "transmets" in last_reply.lower() or "josie" in last_reply.lower())

        # --- 8. Message hors mots-clés connus : filet de sécurité générique ---
        send(page, "est-ce que vous livrez à Bobo-Dioulasso jeudi prochain avant midi ?")
        last_reply = page.inner_text(".bubble.outgoing >> nth=-1")
        check("message non reconnu déclenche aussi le transfert générique",
              "transmets" in last_reply.lower())

        # --- 9. Une alerte apparaît sur l'Accueil après un transfert ---
        check("le bloc À traiter affiche au moins une carte alerte conversation",
              page.locator(".order.escalation").count() >= 1)
        check("l'alerte a bien le badge 'à répondre'",
              "répondre" in page.locator(".order.escalation").first.locator(".status").inner_text())

        # --- 10. Les alertes apparaissent AVANT les commandes dans la liste ---
        first_card_classes = page.get_attribute("#order-list > div:first-child", "class")
        check("la première carte du bloc À traiter est bien une alerte (priorité sur les commandes)",
              "escalation" in (first_card_classes or ""))

        # --- 11. Clic sur l'alerte : rouvre la conversation et retire l'alerte de la liste ---
        escalations_before = page.locator(".order.escalation").count()
        page.click(".order.escalation >> nth=0")
        page.wait_for_timeout(300)
        check("après clic sur l'alerte, elle disparaît du bloc À traiter",
              page.locator(".order.escalation").count() < escalations_before)
        check("le simulateur affiche bien une conversation après réouverture",
              page.locator("#chat .bubble").count() > 0)

        # --- 12. Persistance : les alertes restantes survivent à un reload ---
        page.click('[data-view="home"]')
        send(page, "je peux payer en 4 fois aussi ?")  # ne matche aucun mot-clé -> nouvelle escalade
        escalations_before_reload = page.locator(".order.escalation").count()
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        check("les alertes persistent après reload",
              page.locator(".order.escalation").count() == escalations_before_reload)

        # --- 13. Non-régression : les boutons de choix scriptés fonctionnent toujours à côté du texte libre ---
        check("les boutons de suggestions rapides sont toujours présents",
              page.locator("#suggestions button").count() > 0)

        # --- 14. Non-régression rapide : nav 4 vues + modal profil toujours fonctionnels ---
        page.click('[data-view="orders"]')
        check("nav vers Commandes fonctionne toujours", page.is_visible("#orders-view"))
        page.click('[data-view="catalog"]')
        check("nav vers Catalogue fonctionne toujours", page.is_visible("#catalog-view"))
        page.click('[data-view="customers"]')
        check("nav vers Clients fonctionne toujours", page.is_visible("#customers-view"))
        page.click('[data-view="home"]')
        check("retour vers Accueil fonctionne toujours", page.is_visible("#home-view"))
        page.click("#profile-button")
        check("modal profil s'ouvre toujours", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")

        browser.close()


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8780"],
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
