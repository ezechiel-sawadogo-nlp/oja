# Ọjà — brancher WhatsApp : ce qu'il faut savoir avant de commencer

Ce document décrit le chemin entre le prototype actuel (tout dans le navigateur de la vendeuse)
et un vrai assistant qui répond sur WhatsApp. Rien ici n'est encore codé : c'est la carte.

## 1. Ce qui change fondamentalement

Aujourd'hui, la « cliente » est jouée par Josie dans le simulateur. Avec WhatsApp, les messages
arrivent d'un vrai téléphone, à toute heure, que l'appli soit ouverte ou non. Trois conséquences :

1. **Il faut un serveur** qui tourne en permanence pour recevoir les messages (webhook) et
   répondre. Une page HTML ne peut pas faire ça.
2. **Les données doivent vivre sur ce serveur**, pas dans localStorage : catalogue, profil,
   conversations, commandes. L'interface vendeuse devient un client de ce serveur.
3. **Le moteur de dialogue doit tourner côté serveur.** Bonne nouvelle : `nlu.js` et
   `dialogue.js` sont écrits sans dépendance au DOM (à part les fonctions d'affichage
   `addReply`/`setChoices`, à remplacer par « envoyer un message WhatsApp »). Ils tournent tels
   quels dans Node.js. `eval_nlu.js` le prouve déjà.

## 2. Deux façons d'accéder à WhatsApp

| | WhatsApp Cloud API (Meta) | Bibliothèques non officielles (ex. whatsapp-web.js, Baileys) |
|---|---|---|
| Statut | Officiel, supporté | Non autorisé par WhatsApp : risque de bannissement du numéro |
| Prérequis | Compte Meta Business vérifié, numéro dédié (non utilisé sur l'appli WhatsApp), app Meta Developers | Un téléphone avec WhatsApp, on scanne un QR code |
| Coût | Facturation par conversation (fenêtre de 24 h). Les conversations initiées par la cliente (« service ») ont un quota gratuit mensuel — **vérifier les tarifs en vigueur pour le Burkina Faso** sur developers.facebook.com, ils changent | Gratuit |
| Bon pour | Le produit final, Josie et d'autres commerçantes | Tester le flux réel une semaine avec une seule boutique consentante |

Recommandation : **prototype terrain avec une bibliothèque non officielle sur un numéro de test
jetable**, puis passage à la Cloud API dès qu'une commerçante réelle est prête à s'engager.
Ne jamais brancher le numéro personnel de Josie sur une bibliothèque non officielle.

## 3. Architecture cible (petite, sans surcoût)

```
Cliente (WhatsApp) ──► Meta Cloud API ──► webhook HTTPS ──► serveur Node.js
                                                            ├── nlu.js + dialogue.js (inchangés)
                                                            ├── base SQLite (catalogue, profil, fils, commandes)
                                                            └── API JSON ◄── interface vendeuse (index.html actuel)
```

- **Serveur** : Node.js + Express (ou Fastify), un seul processus. Hébergement gratuit ou
  quasi : Render, Railway, Fly.io (offres gratuites avec limites), ou un petit VPS.
- **Base** : SQLite via `better-sqlite3`. Un fichier, zéro administration. On migre vers
  Postgres seulement si plusieurs boutiques.
- **Assistant de secours** : Ollama sur le même serveur si la machine a assez de RAM
  (≈ 4–8 Go pour un modèle 3B), sinon désactivé. `assistant.js` fonctionne déjà en Node.
- **Interface vendeuse** : le `index.html` actuel, servi par le même serveur, où `read()`/`save()`
  deviennent des appels `fetch()` vers l'API. Une couche d'authentification simple (mot de passe
  par boutique) suffit au début.

## 4. Étapes, dans l'ordre

**État au 7 septembre 2026 : les étapes 1 à 3 sont faites** (`store.js`, `server/server.js`, `server/engine.js`). Le webhook de l'étape 4 reçoit et journalise déjà les messages ; il reste à le brancher sur `engine.js` et à envoyer les réponses via l'API Meta.

1. Extraire `read`/`save` et les cinq listes (`products`, `orders`, `shopProfile`,
   `escalations`, `threads`) derrière une petite couche `store.js` avec deux implémentations :
   localStorage (aujourd'hui) et API HTTP (demain). Les tests Playwright restent valides.
2. Créer le serveur : routes `GET/PUT /api/products`, `/api/orders`, `/api/profile`,
   `/api/threads`. Brancher l'interface dessus.
3. Faire tourner `dialogue.js` côté serveur avec un adaptateur « transport » : `addReply` ⇒
   envoi WhatsApp, `setChoices` ⇒ boutons interactifs WhatsApp (jusqu'à 3) ou liste numérotée.
4. Webhook WhatsApp : vérification du token, réception des messages texte/image, routage vers
   le bon fil (par numéro de téléphone = identité de la cliente).
5. Reprise en main : quand Josie écrit depuis l'interface, le serveur envoie sur WhatsApp et
   met le fil en pause, exactement comme `conversations.js` le fait déjà.
6. Seulement ensuite : plusieurs boutiques, paiements mobile money, statistiques.

## 5. Ce qui restera à décider avec Josie

- Le numéro : un nouveau numéro « boutique » (recommandé) ou migrer son numéro actuel.
- Les heures de réponse automatique : Ọjà répond-il la nuit ? (oui par défaut, c'est l'intérêt).
- La signature : « Ọjà, assistante de Josie Style » ou parler au nom de la boutique.
- Les mots à ne jamais utiliser, les formules de politesse locales, les langues (mooré, dioula).
