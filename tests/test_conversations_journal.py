"""
Tests du chantier "Conversations" (conversations.js) : journal persistant des fils, vue
Conversations (desktop + mobile), réouverture d'un fil là où il en était, alerte -> bon fil,
reprise en main par la vendeuse (Ọjà en pause) et retour à Ọjà.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8965"
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


def skip_onboarding(page):
    page.click('[data-category="Vêtements"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")
    page.wait_for_timeout(150)


def last_reply(page):
    return txt(page.inner_text(".bubble.outgoing >> nth=-1"))


def buttons(page):
    return page.locator("#suggestions button").all_inner_texts()


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — Journal : rien n'est enregistré sans interaction, puis tout persiste
        # ============================================================
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        page.click('[data-view="conversations"]')
        check("vue Conversations accessible depuis la barre latérale", page.is_visible("#conversations-view"))
        check("au premier chargement, le journal est vide (l'exemple de démarrage n'est pas enregistré)", page.locator(".thread-card").count() == 0)
        check("le badge Conversations est masqué quand rien n'attend la vendeuse", not page.is_visible("#conversation-count"))
        check("le téléphone indique avec qui on parle", "Nouvelle cliente" in page.inner_text("#phone-thread-label"))

        send(page, "vous livrez en combien de temps ?")  # -> transfert (profil vide)
        check("une interaction enregistre le fil dans le journal", page.locator(".thread-card").count() == 1)
        check("le fil est marqué « À vous de répondre » après un transfert", "À vous de répondre" in page.inner_text(".thread-card .status"))
        check("le badge Conversations compte le fil à traiter", page.inner_text("#conversation-count") == "1")

        # --- Simuler une cliente : nouveau fil, nom capturé ---
        page.click('[data-view="catalog"]')
        page.locator(".catalog-item", has_text="Robe satin beige").get_by_text("Simuler une cliente").click()
        page.wait_for_timeout(200)
        page.locator("#suggestions button", has_text="M").first.click()
        page.wait_for_timeout(150)
        send(page, "je m'appelle Ramata Ouédraogo")
        page.click('[data-view="conversations"]')
        check("« Simuler une cliente » crée un second fil", page.locator(".thread-card").count() == 2)
        check("le nom donné par la cliente devient le nom du fil", "Ramata Ouédraogo" in page.inner_text(".thread-card >> nth=0"))
        check("le fil en cours est marqué « Ọjà répond »", "Ọjà répond" in page.inner_text(".thread-card >> nth=0 >> .status"))
        check("l'aperçu montre le dernier message", "livraison" in page.inner_text(".thread-card >> nth=0").lower() or "retrait" in page.inner_text(".thread-card >> nth=0").lower())

        # --- Reload : persistance + réouverture au bon endroit ---
        page.reload()
        if page.locator("#onboarding:not(.hidden)").count():
            skip_onboarding(page)
        page.click('[data-view="conversations"]')
        check("les fils survivent au rechargement", page.locator(".thread-card").count() == 2)
        page.locator(".thread-card", has_text="Ramata").first.click()
        page.wait_for_timeout(200)
        check("ouvrir un fil réaffiche tous ses messages", page.locator("#chat .bubble").count() >= 5)
        check("le téléphone affiche le nom de la cliente et le produit", "Ramata Ouédraogo" in page.inner_text("#phone-thread-label") and "Robe satin beige" in page.inner_text("#phone-thread-label"))
        check("les boutons de choix de l'étape en cours sont reproposés", "Retrait en boutique" in buttons(page))
        page.locator("#suggestions button", has_text="Retrait en boutique").first.click()
        page.wait_for_timeout(150)
        check("le moteur reprend exactement là où il en était (étape paiement)", "Orange Money" in buttons(page))
        page.locator("#suggestions button", has_text="Wave").first.click()
        page.wait_for_timeout(150)
        chat_text = txt(page.inner_text("#chat"))
        check("commande finalisée avec la taille choisie avant le rechargement", "Robe satin beige · Beige · Taille M" in chat_text)
        page.click('[data-view="conversations"]')
        check("le fil passe en « Commande prise »", "Commande prise" in page.inner_text(".thread-card >> nth=0 >> .status"))

        # --- Alerte Accueil -> bon fil ---
        page.click('[data-view="home"]')
        escalation = page.locator(".order.escalation").first
        check("l'alerte du premier fil est bien sur l'Accueil", "livrez" in escalation.inner_text())
        escalation.click()
        page.wait_for_timeout(200)
        check("cliquer l'alerte ouvre le fil concerné (pas une nouvelle conversation)", "vous livrez en combien de temps" in page.inner_text("#chat"))
        check("l'alerte disparaît de l'Accueil", page.locator(".order.escalation").count() == 0)

        # ============================================================
        # PARTIE 2 — Reprise en main par la vendeuse
        # ============================================================
        page.click('[data-composer-mode="seller"]')
        check("le mode boutique change la consigne du champ de saisie", "Josie Style" in page.get_attribute("#composer-input", "placeholder"))
        send(page, "Bonjour, c'est Josie. Je livre à Ouaga en 24h, où êtes-vous ?")
        check("le message de la vendeuse apparaît comme bulle boutique", page.locator(".bubble.seller").count() == 1)
        check("une étiquette indique que Josie répond", "Josie K. répond" in page.inner_text("#chat"))
        check("Ọjà n'a pas répondu à la place de Josie", "Bonjour, c'est Josie" in last_reply(page))
        check("la bannière « Ọjà en pause » est visible", page.is_visible("#oja-paused"))
        check("les boutons de choix d'Ọjà sont retirés", len(buttons(page)) == 0)

        page.click('[data-composer-mode="customer"]')
        bubbles_before = page.locator("#chat .bubble").count()
        send(page, "à Tampouy, c'est possible ?")
        check("en pause, la cliente peut écrire mais Ọjà ne répond pas", page.locator("#chat .bubble").count() == bubbles_before + 1)
        page.click('[data-view="conversations"]')
        check("le fil est marqué « Vous répondez »", "Vous répondez" in page.inner_text(".thread-card >> nth=0 >> .status"))
        check("un compteur de non-lus signale le message de la cliente", page.locator(".thread-card >> nth=0 >> .unread").count() == 1)

        page.locator(".thread-card >> nth=0").click()
        page.wait_for_timeout(150)
        page.click("#resume-oja")
        page.wait_for_timeout(150)
        check("« Rendre la main » : Ọjà annonce qu'il reprend", "reprends" in txt(page.inner_text("#chat")).lower())
        check("la bannière de pause disparaît", not page.is_visible("#oja-paused"))
        page.click('[data-view="conversations"]')
        check("le fil repasse en « Ọjà répond »", "Ọjà répond" in page.inner_text(".thread-card >> nth=0 >> .status"))

        # --- Réglages : l'export inclut le journal ---
        page.click("#settings-button")
        with page.expect_download() as download_info:
            page.click("#export-data-button")
        path = download_info.value.path()
        import json
        exported = json.load(open(path))
        check("l'export contient le journal des conversations", "oja-conversations" in exported and len(exported["oja-conversations"]) == 2)
        browser.close()

        # ============================================================
        # PARTIE 3 — Mobile : l'onglet Conversations montre la liste et le téléphone
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(BASE_URL)
        skip_onboarding(page)
        send(page, "merci")
        page.click('[data-mobile-view="conversations"]')
        check("[mobile] l'onglet Conversations affiche la liste des fils", page.is_visible("#conversations-view") and page.locator(".thread-card").count() == 1)
        check("[mobile] le téléphone reste visible sous la liste", page.is_visible(".phone-zone"))
        page.click('[data-mobile-view="home"]')
        check("[mobile] retour Accueil : liste et téléphone se cachent", not page.is_visible("#conversations-view") and not page.is_visible(".phone-zone"))
        browser.close()

    print(f"\n{passed}/{passed + failed} tests passés")


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8965"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1)
    try:
        run()
    finally:
        server.terminate()
    if failed:
        raise SystemExit(1)
