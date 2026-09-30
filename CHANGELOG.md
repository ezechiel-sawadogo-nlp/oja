# Ọjà — journal des chantiers

## 2026-09-30 — Correction d'une course dans le formulaire produit (368 tests Playwright)

- À la modification d'un article, le dépliage automatique des sections remplies (différé de 0 ms) pouvait refermer une section que la vendeuse venait d'ouvrir. Visible sur GitHub Actions, où 2 fichiers de tests échouaient par intermittence. Le dépliage n'ouvre plus que les sections remplies et ne referme jamais rien ; le repli initial est fait tout de suite. +1 test de régression.

## 2026-09-30 — Deux faux amis corrigés (v2.6)

- « vous faites des robes sur mesure ? » ne répond plus par la liste des tailles, et « ma commande d'hier est arrivée où ? » (ou « où en est ma commande ») ne démarre plus une nouvelle commande. Mécanisme : des règles de faux amis dans `nlu.js` retirent l'intention déclenchée par erreur, et le message part à l'assistant (ou à la vendeuse sans assistant).
- Routage sur le jeu inédit : 70/80 à l'aveugle → 72/80 après correction (ces deux phrases ne sont donc plus inédites, ce que le README précise). NLU inédit : 60/80 → 62/80.
- +4 phrases au corpus de non-régression (101), +2 tests moteur (19).

## 2026-09-30 — Évaluation sur un jeu inédit, README refait

- **Jeu inédit** `corpus/test_inedit.jsonl` : 80 messages écrits après coup, dans le style des clientes (SMS, formules locales, questions doubles), avec l'intention et le routage attendus. Règles **non** retouchées après la mesure : NLU 60/80 (75 %), contre 100 % sur le corpus d'ajustement ; routage 70/80 (87,5 %).
- **`eval_routing.js`** : qui répond, entre les règles, l'assistant et la vendeuse ? Il utilise le moteur réel, avec une matrice attendu/obtenu. Sur le jeu inédit, 60 % des messages sont traités par les règles, 33 % par l'assistant et 8 % transférés directement.
- `server/engine.js` : option `onFallback`, pour brancher le repli (évaluation aujourd'hui, assistant côté serveur pour WhatsApp demain) ; 3 tests moteur.
- `eval_nlu.js --file` ; scripts `eval:routing`, `eval:inedit` ; l'évaluation du routage tourne dans GitHub Actions.
- README réécrit en français (démo, schéma, résultats, choix de conception, limites) ; `docs/README.fr.md` supprimé (fusionné) ; qwen2.5:7b recommandé.

## 2026-09-30 — Reprise de la commande (367 tests Playwright)

- **Ọjà reprend la commande** après une réponse « à côté » : une question de conseil (assistant), le prix, le stock, les horaires, la livraison, le paiement ou la matière posés en pleine commande. La réponse vient, puis la question en cours est reposée (taille, nom, livraison…), et la cliente ne reste pas bloquée.
- **Correction** : « Taille M, je veux la commander » retient la taille M tout de suite (« Avec plaisir 🌷 Taille M, c'est noté. ») et passe à la question suivante. Avant, Ọjà proposait M puis redemandait la taille.
- Réglages : suggestions de modèles (llama3.2, qwen2.5:7b pour un meilleur français, qwen2.5:3b, mistral) et commande d'installation ; délai porté à 60 s pour les modèles 7B sur processeur.
- Tests : `test_conseil.py` passe à 30 tests ; les tests qui lisaient seulement la dernière bulle lisent maintenant la réponse et la question reposée.

## 2026-09-30 — Assistant local : état visible et diagnostic (362 tests Playwright)

- **On voit si l'assistant est activé** : une pastille « Assistant Ollama activé » apparaît au-dessus du téléphone, et les Réglages confirment « ✓ Enregistré » à chaque changement. L'enregistrement est automatique, il n'y a pas de bouton à chercher.
- **On voit pourquoi il n'a pas répondu** : quand l'assistant ne répond pas, une étiquette rouge dans le simulateur (vue par la vendeuse, jamais envoyée à la cliente) en donne la raison : Ollama injoignable, délai dépassé, modèle non installé, réponse illisible, modèle pas sûr, ou garde-fou.
- **Premier appel plus fiable** : délai porté de 12 s à 45 s ; le modèle est préchargé en mémoire dès l'activation et à l'ouverture de la page (`keep_alive` 30 min). « Tester la connexion » fait maintenant un vrai essai de réponse et donne son temps.
- Lecture plus tolérante des réponses des petits modèles : JSON entouré de texte, `"confident": "true"` entre guillemets.

## 2026-09-30 — Questions de conseil confiées à l'assistant local (353 tests Playwright)

- **Nouvelle intention `advice`** (NLU) : entretien et lavage, repassage, tenue du tissu, coupe (« ça taille petit ? »), façon de porter ou d'assortir, usage d'un cosmétique, type de peau ou de cheveux, étanchéité, bijou qui noircit, occasion. Elle prime sur les intentions voisines que ses mots déclenchent aussi : « le tissu est transparent ? » ne répond plus « cet article est en satin », « ça taille petit ? » ne liste plus les tailles, « c'est bon pour les peaux grasses ? » n'est plus pris pour un « oui », « ça se porte avec quoi ? » ne demande plus de photo portée.
- **Assistant (Ollama)** : ces questions lui sont confiées au lieu d'être transférées. Le prompt distingue deux types de réponse. Les faits de la boutique (prix, stock, livraison, paiement…) viennent uniquement des données. Les conseils peuvent venir des connaissances générales, avec prudence : ils s'appuient sur la matière ou le type de l'article, restent généraux sinon, et renvoient vers un pharmacien pour la peau, les allergies et la grossesse. Garde-fou : un conseil ne cite jamais de montant. Dans une question mixte (« elle coûte combien et ça se lave en machine ? »), les règles répondent d'abord, puis l'assistant.
- **Jusqu'à 3 réponses par message** (au lieu de 2) : une troisième question n'est plus ignorée sans rien dire.
- Correction : « tu peux baisser le prix ? » est bien traité comme une négociation (transfert à la vendeuse). Avant, « baisser » donnait seulement le prix.
- Corpus NLU : 97 phrases (+14 questions de conseil ; « ça se lave bien ? », jusque-là hors périmètre, devient une question de conseil). `tests/test_conseil.py` : 16 tests avec Ollama simulé.
- Sans Ollama activé, rien ne change : les questions de conseil sont transférées comme avant.

## 2026-09-30 — Préparation de la publication GitHub (337 tests Playwright + 14 tests moteur)

- **Sécurité du serveur** : les fichiers statiques passent par une liste blanche (seule l'interface est servie). Avant, `//.env`, `/Server/data/…` sous Windows ou `/tests/…` pouvaient contourner le filtre. Le webhook vérifie la signature Meta `X-Hub-Signature-256` si `WHATSAPP_APP_SECRET` est défini. Le fichier `.env` est lu au démarrage, sans dépendance.
- **Tests portables** : ils sont regroupés dans `tests/`, sans chemin en dur ni image manquante. `tests/run_all.py` lance toute la suite, et chaque fichier renvoie un code d'erreur en cas d'échec. 5 nouveaux tests couvrent la liste blanche et la signature du webhook.
- `npm test`, intégration continue GitHub Actions, `.gitignore` (données de la boutique, exports, `.env`, fichiers générés par les tests), `.env.example`.
- README en anglais avec capture, guide français déplacé dans `docs/README.fr.md`, licence.

## 2026-09-07 — Démarrage guidé, lisibilité, formulaire allégé (332 tests Playwright)

- **Boutique vide au départ** : plus de produits ni de commandes de démonstration imposés. Onboarding en 3 étapes (catégories → premier article → Ọjà répond), avec « Découvrir d'abord avec 3 articles d'exemple » et « Plus tard ». États vides explicites sur l'Accueil et dans le téléphone ; le parcours de démarrage sur l'Accueil suit la progression et disparaît quand tout est fait.
- **Lisibilité du téléphone** : bulles 14,5 px, boutons 13,5 px, en-tête et saisie agrandis, téléphone un peu plus large.
- **Formulaire produit** : l'essentiel d'abord (nom, prix, stock, catégorie, variantes, matière, photo 1) ; le reste dans des sections « Options avancées » / « Plus de médias » repliées, ouvertes automatiquement à la modification si elles contiennent quelque chose.
- `test_demarrage.py` : 18 tests.

## 2026-09-07 — Serveur : données partagées et moteur hors navigateur (314 tests Playwright + 14 tests moteur)

- `store.js` : couche de stockage unique ; localStorage par défaut, serveur quand la page est servie par `server/server.js` (état injecté dans la page, écritures groupées, bandeau « serveur injoignable » ou « modifié sur un autre appareil »).
- `server/server.js` (Node, zéro dépendance) : sert l'interface, API `/api/state` (GET, PUT par lot, DELETE), `/api/version`, `/api/health`, mot de passe optionnel (`OJA_PASSWORD`), fichier JSON écrit de façon atomique, webhook WhatsApp (vérification du jeton + journal des messages reçus).
- `server/engine.js` : le moteur (`nlu.js` + `dialogue.js`, inchangés) tourne dans Node ; sessions avec `start / send / choose / snapshot / restore`. `server/chat.js` pour converser dans le terminal, `server/engine.test.js` pour le tester.
- Corrections : nom sans apostrophe (« je m appelle Awa »), lettre isolée non prise pour une taille hors contexte, champ de saisie du téléphone illisible en mode nuit, téléphone coupé sur écrans bas.
- `test_serveur.py` : 19 tests (état injecté, partage entre deux navigateurs, mot de passe, webhook, mode statique inchangé).

## 2026-09-05 — Panier, stock, variantes, échelonné, assistant local, corpus NLU (295/295 tests)

- **Panier multi-produits** : « Ajouter un autre article » à chaque étape, ou « je veux aussi le sac Lune » en texte libre ; chaque article pose ses propres questions ; récapitulatif du panier avant le nom ; commande à plusieurs lignes avec total + livraison ; état du panier persisté dans le fil.
- **Stock réel** : chaque commande décrémente le stock ligne par ligne (jamais négatif) ; si le stock ne suffit pas, Ọjà le dit et ajuste la quantité.
- **Photos par variante** : chaque photo du formulaire peut être rattachée à une couleur/teinte ; la photo de la couleur choisie est envoyée automatiquement, et « d'autres photos » privilégie la variante en cours.
- **Paiement échelonné configurable** (profil : montant minimum + % d'avance) ; sans configuration, Ọjà transfère comme avant ; affiché dans les règles de vente.
- **Assistant de secours (Ollama, optionnel, désactivé par défaut)** : appelé seulement quand les règles ne comprennent rien, avec le catalogue et les règles de la boutique dans le prompt, réponse JSON « confident » ; garde-fou côté client sur les montants ; sinon transfert. Réglage + test de connexion dans Réglages.
- **Corpus d'évaluation NLU** : `corpus/corpus_clientes.jsonl` (80 phrases réalistes, 22 intentions) + `eval_nlu.js` ; le NLU a été ajusté dessus (82,5 % → 100 %). C'est un jeu de non-régression, pas une mesure sur données inédites : à enrichir avec de vraies phrases de clientes.
- Export CSV des commandes ; son optionnel quand un fil passe « à vous de répondre » ; bannière « premier article » tant que le catalogue est celui de démo.
- `docs/WHATSAPP.md` : la marche à suivre pour la vraie connexion WhatsApp (serveur, données, coûts, ordre des étapes).

## 2026-09-05 — Conversations : journal, vue, reprise en main (269/269 tests)

- Nouveau module `conversations.js` : chaque échange est un fil persistant (cliente, produit, messages, état, commande liée, état du moteur de dialogue) dans `oja-conversations`. L'exemple de démarrage n'est enregistré qu'à la première interaction.
- Vue **Conversations** (barre latérale desktop, onglet mobile au-dessus du téléphone) : liste des fils triés par activité, état (« Ọjà répond », « À vous de répondre », « Vous répondez », « Commande prise »), aperçu du dernier message, non-lus ; badge dans la navigation.
- Ouvrir un fil réaffiche l'historique et repropose la question en cours : le moteur reprend exactement où il en était, même après rechargement.
- Une alerte de l'Accueil ouvre désormais le fil concerné (plus une nouvelle conversation).
- **Reprise en main** : sélecteur « Je joue la cliente » / « Je réponds moi-même » sous le téléphone. En mode boutique, Josie écrit à la place d'Ọjà, qui se met en pause sur ce fil (bannière + bouton « Rendre la main à Ọjà »). Les messages de la cliente pendant la pause sont comptés en non-lus.
- Le téléphone indique avec qui on parle et sur quel produit ; les heures des bulles sont réelles.
- Export et réinitialisation couvrent la nouvelle clé.
- `test_conversations_journal.py` : 37 tests.

## 2026-09-05 — Refonte visuelle « Faso dan fani » (232/232 tests)

- Direction : indigo profond, ocre, coton écru — le tissu burkinabè plutôt que le crème/terracotta générique. Une seule famille typographique (Bricolage Grotesque, chargée depuis Google Fonts ; repli système hors ligne).
- Signature : bande tissée en haut de l'écran, barre latérale indigo, chiffre du jour en ocre. Le simulateur WhatsApp est posé sur un fond nuit pour se détacher de l'espace vendeuse.
- Plus de libellés en majuscules ni de flèches décoratives ; les rayons de bordure encodent la hiérarchie (panneaux 20 px, cartes 14 px, contrôles 10 px, puces rondes).
- Mode nuit reconstruit sur les mêmes jetons ; focus clavier visible ; animations coupées si `prefers-reduced-motion`.
- Mobile : barre du bas, en-tête compact (actions au-dessus du titre), formulaire produit plein écran, commandes sur deux lignes, toast au-dessus de la nav.
- `styles.css` réécrit de zéro : 2 338 → ~380 lignes, tous les sélecteurs existants conservés (aucun test modifié).

## 2026-09-05 — Moteur de dialogue unifié + NLU (232/232 tests)

**Refactor (sans changement de comportement pour les 187 tests existants)**
- Les trois flux Vêtements / Cosmétiques / Accessoires (~60 % de code dupliqué) sont remplacés par un moteur unique dans `dialogue.js`, piloté par un schéma déclaratif par catégorie.
- Les règles à mots-clés (`FREE_TEXT_RULES`) sont remplacées par `nlu.js`.
- `app.js` passe de 1 261 à ~830 lignes et ne contient plus que l'interface.

**Nouvelles capacités de conversation**
- Réponses en texte libre interprétées selon la question en cours : taille, couleur, teinte, format, nom, livraison/retrait, moyen de paiement.
- Un message peut régler plusieurs attributs à la fois (« corail en 5 g », « argent en 54 »).
- Détection d'intentions scorée et multi-intentions (« c'est en quelle matière et vous livrez où ? » → deux réponses).
- Tolérance aux fautes (« horraires », « livraisson ») et aux variantes (accents, élisions, majuscules).
- Nouvelles intentions : prix, stock, moyens de paiement, retrait, négociation (→ transfert), salutation, demande d'infos, relance après clôture.
- Quantité (« j'en veux 2 ») prise en compte dans le total.
- Une question posée pendant une attente (« vous livrez en combien de temps ? ») n'est jamais confondue avec une réponse.
- « Parler à la boutique » disponible à chaque étape (cahier des charges).
- Le second « doute sur la qualité » crée réellement une alerte pour la vendeuse.
- Le flux dynamique respecte désormais la règle « livraison uniquement si zone + tarif renseignés » (avant : « Nous livrons à  pour 0 FCFA » possible).

**Corrections d'interface**
- Nom de boutique dynamique partout (messages, en-tête du simulateur, logo) : plus de « Josie Style » en dur.
- Date de l'Accueil et prénom générés ; compteur « Clients en discussion » réel ; statut catalogue réel.
- Règles de vente du Catalogue dérivées du profil (elles reflètent exactement ce qu'Ọjà dit).
- « Voir tout → » ouvre Commandes ; « Modifier les règles → » ouvre Infos boutique.
- Le statut d'une commande s'arrête à « livrée » (plus de retour à « à confirmer »).
- Plus de message de transfert en double quand la réponse l'annonçait déjà.

**Tests**
- `test_moteur_dialogue.py` : 45 tests (Vêtements, Cosmétiques, Accessoires, intentions, non-régression UI).
