"""
Tests des questions de conseil (entretien, coupe, usage, peau, étanchéité…) confiées à
l'assistant local (Ollama, simulé ici) au lieu d'être transférées à la vendeuse, et des
garde-fous qui restent en place : négociation et demande d'humain toujours transférées,
aucun montant dans un conseil, transfert si Ollama est éteint ou pas sûr de lui.
Vérifie aussi qu'un message à trois questions reçoit trois réponses, et que la commande reprend
(question en cours reposée) après une réponse de conseil ou à règles.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import json
import re
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:8969"
passed = 0
failed = 0

PROFILE = {"shopName": "Josie Style", "sellerName": "Josie K.", "contact": "", "description": "", "photo": "", "logo": "",
           "hours": "8h - 20h, du lundi au samedi", "deliveryDelay": "24 h", "deliveryZone": "Ouagadougou", "deliveryFee": "1000",
           "installmentMin": "", "installmentPercent": ""}

CONSEIL = "Pour un article en satin, un lavage à la main à l'eau froide est plus sûr 🌷"


def check(label, condition):
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {label}")
    else:
        failed += 1
        print(f"  FAIL {label}")


def txt(value):
    return re.sub(r"\s+", " ", value).strip()


def outgoing(page):
    return [txt(t) for t in page.locator(".bubble.outgoing").all_inner_texts()]


def send(page, text, wait=450):
    page.fill("#composer-input", text)
    page.click("#send-button")
    page.wait_for_timeout(wait)


def run():
    calls = []
    warmups = []

    def ollama(route):
        body = json.loads(route.request.post_data or "{}")
        if not body.get("prompt"):  # préchauffage du modèle (prompt vide) : pas une vraie question
            warmups.append(body)
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"response": ""}))
            return
        calls.append(body)
        message = body.get("prompt", "").split("NOUVEAU MESSAGE DE LA CLIENTE")[-1]
        if "pressing" in message:
            answer = {"answer": "Un pressing coûte environ 5 000 FCFA 🌷", "confident": True, "type": "conseil"}
        elif "football" in message:
            answer = {"answer": "", "confident": False}
        else:
            answer = {"answer": CONSEIL, "confident": True, "type": "conseil"}
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"response": json.dumps(answer)}))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        page.click('[data-category="Vêtements"]')
        page.click("#continue-button")
        page.click("#load-demo-button")
        page.wait_for_selector("#onboarding.hidden", state="attached")
        page.evaluate("p => localStorage.setItem('oja-profile', JSON.stringify(p))", PROFILE)
        page.reload()
        page.wait_for_timeout(300)

        # --- Sans assistant : comportement inchangé (transfert) ---
        send(page, "ça se lave en machine ?")
        check("sans assistant : une question de conseil est transférée comme avant", "transmets" in outgoing(page)[-1].lower())

        # --- Trois questions dans un message : trois réponses (plus de question ignorée) ---
        before = len(outgoing(page))
        send(page, "vous livrez où, c'est quoi vos horaires et on peut payer par wave ?")
        replies = " ".join(outgoing(page)[before:])
        check("trois questions -> trois réponses (livraison, horaires, paiement)", "Ouagadougou" in replies and "8h" in replies and "Wave" in replies)

        # --- Activer Ollama (simulé) ---
        check("pastille « Assistant Ollama activé » absente tant qu'il est désactivé", not page.is_visible("#assistant-badge"))
        page.route("**/api/generate", ollama)
        page.click("#settings-button")
        check("réglages : il est dit que l'enregistrement est automatique", "automatiquement" in page.inner_text("#assistant-saved"))
        page.select_option("#assistant-provider", "ollama")
        page.fill("#assistant-model", "llama3.2")
        page.dispatch_event("#assistant-model", "change")
        check("réglages : confirmation visible « Enregistré : l'assistant Ollama est activé »", "Enregistré" in page.inner_text("#assistant-saved") and "activé" in page.inner_text("#assistant-saved"))
        page.click(".close-settings-modal")
        page.wait_for_timeout(200)
        check("pastille « Assistant Ollama activé » visible au-dessus du téléphone", page.is_visible("#assistant-badge"))
        check("le modèle est préchauffé dès l'activation (prompt vide, keep_alive)", len(warmups) >= 1 and warmups[-1].get("keep_alive"))
        page.reload()
        page.wait_for_timeout(300)
        check("après rechargement : toujours activé (réglage bien enregistré)", page.is_visible("#assistant-badge"))

        send(page, "ça se lave en machine ?")
        prompt = calls[-1]["prompt"] if calls else ""
        check("conseil : l'assistant est appelé avec l'indice « question de CONSEIL »", len(calls) == 1 and "INDICE : ce message est une question de CONSEIL" in prompt)
        check("conseil : le prompt contient la matière de l'article (satin)", '"matiere":"Satin"' in prompt)
        check("conseil : le prompt autorise les connaissances générales mais garde la boutique stricte", "connaissances générales" in prompt and "UNIQUEMENT avec les DONNÉES" in prompt)
        check("conseil : la réponse du modèle est affichée, sans transfert", "lavage à la main" in outgoing(page)[-1] and "transmets" not in outgoing(page)[-1].lower())

        cases = [
            ("le tissu est transparent ?", "« le tissu » ne déclenche plus la réponse « matière »", "Cet article est en"),
            ("ça taille petit ou grand ?", "« ça taille petit » ne déclenche plus la liste des tailles", "n'existe pas en"),
            ("c'est bon pour les peaux grasses ?", "« c'est bon pour… » n'est plus pris pour un « oui »", "Parfait"),
            ("ça se porte avec quoi ?", "« se porte avec » ne demande plus une photo portée", "photo de cet article porté"),
        ]
        for message, label, wrong in cases:
            before, n_calls = len(outgoing(page)), len(calls)
            send(page, message)
            new = " ".join(outgoing(page)[before:])
            check(f"conseil : {label}", len(calls) == n_calls + 1 and "lavage à la main" in new and wrong not in new)

        # Question mixte : règles d'abord, conseil ensuite
        before = len(outgoing(page))
        send(page, "elle coûte combien et ça se lave en machine ?")
        new = outgoing(page)[before:]
        check("question mixte : le prix vient des règles, puis le conseil de l'assistant", len(new) >= 2 and "18 500" in new[0] and "lavage à la main" in new[-1])

        # Garde-fous
        before, n_calls = len(outgoing(page)), len(calls)
        send(page, "je peux la porter au pressing ?")
        check("garde-fou : un conseil qui cite un montant est refusé -> transfert", len(calls) == n_calls + 1 and "transmets" in " ".join(outgoing(page)[before:]).lower())

        n_calls = len(calls)
        send(page, "tu peux baisser le prix ?")
        check("négociation : toujours transférée, sans appel au modèle", len(calls) == n_calls and "transmets" in outgoing(page)[-1].lower())

        n_calls = len(calls)
        send(page, "je veux parler à la boutique")
        check("demande d'humain : toujours transférée, sans appel au modèle", len(calls) == n_calls and page.locator(".bubble.outgoing").count() > 0)

        send(page, "tu as vu le match de football hier ?")
        check("hors sujet : modèle pas sûr -> transfert", "transmets" in outgoing(page)[-1].lower())
        check("diagnostic vendeuse : « pas sûr de sa réponse » affiché dans le simulateur", "pas sûr" in page.locator(".assistant-diag").last.inner_text())

        page.unroute("**/api/generate")
        page.route("**/api/generate", lambda route: route.abort())
        send(page, "ça se lave en machine ?", wait=600)
        check("Ollama injoignable -> transfert (jamais de silence)", "transmets" in outgoing(page)[-1].lower())
        check("diagnostic vendeuse : « Ollama injoignable » affiché", "injoignable" in page.locator(".assistant-diag").last.inner_text())
        check("le diagnostic n'est pas une bulle envoyée à la cliente", "injoignable" not in " ".join(outgoing(page)))
        browser.close()

        # --- Reprise de la commande ---
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(BASE_URL)
        page.click('[data-category="Vêtements"]')
        page.click("#continue-button")
        page.click("#load-demo-button")
        page.wait_for_selector("#onboarding.hidden", state="attached")
        page.evaluate("""p => { localStorage.setItem('oja-profile', JSON.stringify(p));
          localStorage.setItem('oja-settings', JSON.stringify({ sound: false, firstStepDismissed: true, assistant: { provider: 'ollama', url: 'http://localhost:11434', model: 'llama3.2' } })); }""", PROFILE)
        page.route("**/api/generate", ollama)
        page.reload()
        page.wait_for_timeout(300)

        before = len(outgoing(page))
        send(page, "Taille M, je veux la commander.")
        new = " ".join(outgoing(page)[before:])
        check("commande avec précision : « Taille M, c'est noté », sans redemander la taille", "Taille M, c'est noté" in new and "Laquelle" not in new and "On continue avec cette taille" not in new)
        check("commande avec précision : Ọjà passe directement à la question suivante (le nom)", "votre nom" in outgoing(page)[-1])

        before = len(outgoing(page))
        send(page, "ça se lave en machine ?")
        new = outgoing(page)[before:]
        check("reprise après un conseil : réponse de l'assistant, puis la question du nom reposée", len(new) == 2 and "lavage à la main" in new[0] and "votre nom" in new[1])

        before = len(outgoing(page))
        send(page, "vous êtes ouverts jusqu'à quelle heure ?")
        new = outgoing(page)[before:]
        check("reprise après une réponse à règles (horaires) : la question du nom est reposée", len(new) == 2 and "8h" in new[0] and "votre nom" in new[1])

        send(page, "Awa")
        check("la commande continue normalement après les reprises (nom retenu)", "Awa" in " ".join(outgoing(page)[-2:]))
        browser.close()

    print(f"\n{passed}/{passed + failed} tests passés")


if __name__ == "__main__":
    server = subprocess.Popen([sys.executable, "-m", "http.server", "8969"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        run()
    finally:
        server.terminate()
    if failed:
        raise SystemExit(1)
