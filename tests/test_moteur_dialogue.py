"""
Tests du chantier "Moteur de dialogue unifié + NLU" (nlu.js / dialogue.js).

Ce que ce chantier change : un seul moteur pour Vêtements / Cosmétiques / Accessoires, piloté
par un schéma déclaratif ; le texte libre est interprété en contexte (la réponse « M » à la
question de taille, un prénom à la question du nom, « à domicile » à la question livraison) ;
détection d'intention scorée, multi-intentions, tolérance aux fautes ; entités (couleur,
taille, quantité, mode de livraison, moyen de paiement). La règle « ne jamais inventer »
reste : hors catalogue -> transfert à la boutique.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import json
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8960"
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


def skip_onboarding(page, category="Vêtements"):
    page.click(f'[data-category="{category}"]')
    page.click("#continue-button"); page.click("#load-demo-button")
    page.wait_for_selector("#onboarding.hidden", state="attached")


def send(page, text):
    page.fill("#composer-input", text)
    page.click("#send-button")
    page.wait_for_timeout(150)


def txt(value):
    """Les montants formatés par toLocaleString('fr-FR') utilisent une espace fine insécable (U+202F) :
    on la ramène à une espace simple pour pouvoir écrire « 18 500 » dans les assertions."""
    return value.replace("\u202f", " ").replace("\u00a0", " ")


def inner(page, selector):
    return txt(page.inner_text(selector))


def last_reply(page):
    return inner(page, ".bubble.outgoing >> nth=-1")


def recent_replies(page, n=2):
    """Les n dernières bulles d'Ọjà : la réponse, puis la question de la commande reposée."""
    return " ".join(page.locator(".bubble.outgoing").all_inner_texts()[-n:]).replace("\u202f", " ").replace("\xa0", " ")


def buttons(page):
    return page.locator("#suggestions button").all_inner_texts()


def click_button(page, text):
    page.locator("#suggestions button", has_text=text).first.click()
    page.wait_for_timeout(150)


def seed_products(page, products, categories):
    """Injecte un catalogue dans localStorage puis recharge : évite de passer par le formulaire."""
    page.evaluate("([p, c]) => { localStorage.setItem('oja-products', JSON.stringify(p)); localStorage.setItem('oja-categories', JSON.stringify(c)); }", [products, categories])
    page.reload()
    page.wait_for_timeout(200)


def fill_delivery_profile(page, zone="Ouagadougou", fee="1500", delay="2-3 jours", hours="Lun-Sam, 9h-19h"):
    page.click("#profile-button")
    page.wait_for_selector("#profile-modal[open]")
    page.fill("#profile-delivery-zone-input", zone)
    page.fill("#profile-delivery-fee-input", fee)
    page.fill("#profile-delivery-delay-input", delay)
    page.fill("#profile-hours-input", hours)
    page.click("#profile-form .save-button")
    page.wait_for_timeout(200)


MEDIA = {"photos": [], "wornCount": 0, "video": ""}
ROBE = {"id": "robe", "name": "Robe satin beige", "price": 18500, "stock": 5, "category": "Vêtements", "style": "dress", "media": MEDIA,
        "size": {"sizeType": "Standard", "mode": "plusieurs", "values": ["S", "M", "L"]},
        "color": {"mode": "plusieurs", "values": ["Beige", "Noir"]}, "material": "Satin", "gender": "", "setContent": "", "rangeName": "Collection Wax"}
ROBE2 = {**ROBE, "id": "robe2", "name": "Jupe wax", "price": 9000}
ROUGE = {"id": "rouge", "name": "Rouge à lèvres Velours", "price": 4500, "stock": 12, "category": "Cosmétiques", "style": "care", "media": MEDIA,
         "productType": "Rouge à lèvres",
         "shade": {"active": True, "mode": "plusieurs", "values": ["Rouge", "Corail"]},
         "volume": {"active": True, "mode": "plusieurs", "values": ["3 g", "5 g"]},
         "length": {"active": False, "mode": "unique", "values": [""]},
         "texture": {"active": False, "mode": "unique", "values": [""]},
         "expiryDate": "", "boxContent": "", "rangeName": ""}
BAGUE = {"id": "bague", "name": "Bague Soleil", "price": 7000, "stock": 0, "category": "Accessoires", "style": "bag", "media": MEDIA,
         "itemType": "Bague",
         "color": {"mode": "plusieurs", "values": ["Or", "Argent"]}, "material": "Acier inoxydable",
         "dimension": {"active": True, "dimensionType": "Taille-bague", "mode": "plusieurs", "values": ["52", "54"]},
         "packContent": "", "rangeName": ""}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============================================================
        # PARTIE 1 — Vêtements : réponses en texte libre, dans le contexte de la question posée
        # ============================================================
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        seed_products(page, [ROBE, ROBE2], ["Vêtements"])
        fill_delivery_profile(page)
        page.click('[data-view="home"]')
        page.locator("[data-chat-product='robe']").first.click()
        page.wait_for_timeout(200)

        check("intro dynamique : prix et matière annoncés", "18 500" in inner(page, "#chat") and "Satin" in inner(page, "#chat"))
        check("1re question = couleur (plusieurs couleurs)", "Beige, Noir" in last_reply(page))
        send(page, "je prends le noir")
        check("texte libre « je prends le noir » choisit la couleur", "Noir" in last_reply(page) or "tailles" in last_reply(page).lower())
        check("après la couleur, la question de taille est posée", "S, M, L" in inner(page, "#chat"))
        send(page, "vous l'avez en XL ?")
        check("taille hors catalogue : réponse honnête avec les vraies tailles", "n'existe pas en XL" in last_reply(page) and "S, M, L" in last_reply(page))
        send(page, "bon, la M alors")
        check("« la M alors » est compris comme la taille M", "Très bien, M" in inner(page, "#chat"))
        check("après la taille, Ọjà demande le nom", "votre nom" in last_reply(page))
        send(page, "vous livrez en combien de temps ?")
        check("une question pendant l'attente du nom n'est pas prise pour un nom", "2-3 jours" in recent_replies(page))
        check("la question du nom reste en attente (boutons noms toujours proposés)", any("." in b for b in buttons(page)))
        send(page, "je m'appelle awa sawadogo")
        check("le nom est capturé et mis en forme", "Merci Awa Sawadogo" in inner(page, "#chat"))
        check("après le nom, question livraison/retrait", "livraison à domicile" in last_reply(page).lower())
        send(page, "c'est quoi le délai de livraison ?")
        check("question sur le délai pendant l'attente livraison -> infos, pas un choix", "2-3 jours" in recent_replies(page) and "payer" not in recent_replies(page).lower())
        send(page, "à domicile svp")
        check("« à domicile » choisit la livraison et affiche le tarif", "1 500" in last_reply(page) and "payer" in last_reply(page).lower())
        send(page, "par orange money")
        chat_text = inner(page, "#chat")
        check("« par orange money » finalise la commande", "Orange Money" in chat_text and "presque prête" in chat_text)
        check("récap = article + couleur + taille + livraison incluse", "Robe satin beige · Noir · Taille M" in chat_text and "20 000 FCFA (livraison incluse)" in chat_text)
        check("suggestion de collection en clôture", "Jupe wax" in chat_text and "collection" in chat_text)
        first_order = inner(page, "#order-list .order >> nth=0")
        check("la commande apparaît sur l'Accueil au nom d'Awa Sawadogo", "Awa Sawadogo" in first_order and "20 000" in first_order)

        # --- Après clôture : relance possible avec quantité ---
        send(page, "finalement j'en veux 2")
        check("« j'en veux 2 » relance une commande avec la quantité", "2 ×" in last_reply(page) or "c'est noté" in inner(page, "#chat"))
        browser.close()

        # ============================================================
        # PARTIE 2 — Intentions : multi-intentions, fautes, prix, stock, paiement, nom boutique dynamique
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        seed_products(page, [ROBE], ["Vêtements"])
        page.click("#profile-button")
        page.wait_for_selector("#profile-modal[open]")
        page.fill("#profile-shop-name-input", "Boutique Awa")
        page.click("#profile-form .save-button")
        page.wait_for_timeout(200)
        check("l'en-tête du simulateur affiche le nom de boutique du profil", inner(page, "#phone-shop-name") == "Boutique Awa")
        page.click('[data-view="home"]')
        page.locator("[data-chat-product='robe']").first.click()
        page.wait_for_timeout(200)
        check("les messages d'Ọjà utilisent le nom de boutique du profil (plus de « Josie Style » en dur)", "Boutique Awa" in inner(page, "#chat") and "Josie Style" not in inner(page, "#chat"))

        send(page, "c'est combien ?")
        check("intention prix : répond avec le prix", "18 500" in recent_replies(page))
        send(page, "il en reste encore ?")
        check("intention stock : répond avec la disponibilité réelle", "5 en stock" in recent_replies(page))
        send(page, "c'est en quelle matière et vous livrez où ?")
        replies = page.locator(".bubble.outgoing").all_inner_texts()
        check("multi-intentions : matière répondue…", any("Satin" in r for r in replies[-3:]))
        check("…ET livraison non renseignée transférée dans le même message", "transmets" in last_reply(page).lower())
        send(page, "vous avez des horraires ?")
        check("faute de frappe (« horraires ») tolérée -> règle horaires (non renseignées ici -> transfert)", "horaires" in inner(page, ".bubble.outgoing >> nth=-2").lower() or "horaires" in last_reply(page).lower())
        send(page, "comment je peux payer ?")
        check("intention paiement : liste les moyens de paiement du cahier des charges", "Orange Money" in recent_replies(page) and "Wave" in recent_replies(page))
        send(page, "je peux avoir une réduction ?")
        check("négociation : prix rappelé puis transfert à la boutique (jamais de remise inventée)", "transmets" in last_reply(page).lower())
        escalations_before = page.locator(".order.escalation").count()
        click_button(page, "doute")
        click_button(page, "doute")
        check("2e doute -> une alerte est réellement créée pour la vendeuse", page.locator(".order.escalation").count() == escalations_before + 1)
        click_button(page, "Parler à la boutique")
        check("« Parler à la boutique » est proposé à tout moment et crée une alerte", page.locator(".order.escalation").count() == escalations_before + 2)
        send(page, "blablabla xyz")
        check("message incompréhensible -> filet de sécurité (transfert)", "transmets" in last_reply(page).lower())
        browser.close()

        # ============================================================
        # PARTIE 3 — Cosmétiques (question groupée) et Accessoires (couleur + taille de bague, rupture)
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page, "Cosmétiques")
        seed_products(page, [ROUGE, BAGUE], ["Cosmétiques", "Accessoires"])
        page.click('[data-view="home"]')
        page.locator("[data-chat-product='rouge']").first.click()
        page.wait_for_timeout(200)
        check("cosmétiques : question groupée teinte + format", "en Rouge, Corail, et en 3 g, 5 g" in last_reply(page))
        check("cosmétiques : boutons des deux attributs + « Une autre teinte »", "Corail" in buttons(page) and "5 g" in buttons(page) and "Une autre teinte" in buttons(page))
        send(page, "corail en 5g")
        check("texte libre répond aux DEUX attributs en un message", "Corail" in last_reply(page) and "5 g" in last_reply(page) or "votre nom" in last_reply(page))
        check("les deux attributs réglés -> question du nom", "votre nom" in last_reply(page))

        page.click('[data-shop-category="Accessoires"]')
        page.wait_for_timeout(100)
        page.locator("[data-chat-product='bague']").first.click()
        page.wait_for_timeout(200)
        check("accessoires : question groupée couleur + taille de bague", "Quelle couleur et quelle taille de bague" in last_reply(page))
        check("accessoires : bouton « Quel est le matériau ? » proposé", "Quel est le matériau ?" in buttons(page))
        click_button(page, "Quel est le matériau ?")
        check("matériau : réponse avec la vraie valeur", "Acier inoxydable" in inner(page, ".bubble.outgoing >> nth=-2"))
        escalations_before = page.locator(".order.escalation").count()
        send(page, "encore disponible ?")
        check("stock à 0 -> annonce la rupture et prévient la boutique (pas de fausse disponibilité)", "rupture" in last_reply(page).lower() and "préviens" in last_reply(page).lower())
        check("stock à 0 -> une alerte est créée sans répéter la formule de transfert", page.locator(".order.escalation").count() == escalations_before + 1)
        send(page, "argent en 54")
        check("accessoires : couleur + taille de bague comprises dans un seul message", "votre nom" in last_reply(page))
        browser.close()

        # ============================================================
        # PARTIE 4 — Non-régression UI (Accueil dynamique, cycle des statuts, boutons morts réparés)
        # ============================================================
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        skip_onboarding(page)
        check("date de l'Accueil générée (plus « JEUDI 20 AOÛT » en dur)", inner(page, "#home-date") != "JEUDI 20 AOÛT" and len(inner(page, "#home-date")) > 5)
        check("règles de vente dérivées du profil (livraison non renseignée)", "Non renseignée" in inner(page, "#rule-grid"))
        page.click(".orders-panel [data-view='orders']")
        check("« Voir tout » ouvre la vue Commandes", page.is_visible("#orders-view"))
        page.click('[data-view="catalog"]')
        page.click('[data-action="edit-rules"]')
        check("« Modifier les règles » ouvre Infos boutique", page.is_visible("#profile-modal"))
        page.click(".close-profile-modal")
        page.click('[data-view="orders"]')
        status = page.locator("#orders-list-full [data-order-id]").first
        for _ in range(4):
            status.click()
            page.wait_for_timeout(100)
        check("le statut s'arrête à « livrée » (plus de retour à « à confirmer »)", page.locator("#orders-list-full [data-order-id]").first.inner_text() == "livrée")
        browser.close()

    print(f"\n{passed}/{passed + failed} tests passés")


if __name__ == "__main__":
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8960"],
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
