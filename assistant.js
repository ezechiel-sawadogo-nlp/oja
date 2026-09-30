// =====================================================================================
// assistant.js — Filet de secours par modèle de langue (optionnel, local, gratuit)
//
// Le moteur à règles (nlu.js + dialogue.js) reste premier : rapide, prévisible, zéro
// invention. Ce module intervient dans deux cas, juste avant le transfert à la vendeuse :
//  1. les règles ne reconnaissent rien ;
//  2. la cliente pose une question de CONSEIL (entretien, lavage, coupe, usage d'un cosmétique,
//     étanchéité, occasion… — intention `advice` du NLU).
// Le modèle local (Ollama, open source, sans compte ni paiement) distingue deux sortes de
// réponses :
//  - « boutique » (prix, stock, livraison, paiement, horaires…) : UNIQUEMENT depuis les données
//    de la boutique, jamais inventé ;
//  - « conseil » : connaissances générales, prudentes, appuyées sur la matière ou le type de
//    l'article quand on les connaît, sans prix, stock, délai ni promesse.
// Réponse JSON : { "answer": "...", "confident": true|false, "type": "boutique"|"conseil" }.
// S'il n'est pas sûr, s'il ne répond pas ou si le service est injoignable, on transfère comme
// avant. Désactivé par défaut ; activable dans Réglages.
//
// Pour autoriser une page locale à appeler Ollama, lancer le service avec :
//   OLLAMA_ORIGINS="*" ollama serve       (puis : ollama pull qwen2.5:7b)
//
// Dépendances (app.js) : settings, saveSettings, shopProfile, products, deliveryAvailable, money.
// =====================================================================================

// Premier appel : Ollama charge le modèle en mémoire (souvent 10 à 30 s sur un ordinateur
// portable, davantage pour un modèle 7B). On attend donc largement, et on « réveille » le modèle dès que l'assistant est
// activé ou que la page s'ouvre (warmUpAssistant), pour que la première cliente n'attende pas.
const ASSISTANT_TIMEOUT_MS = 60000; // un modèle 7B sur processeur peut mettre 20 à 40 s
const ASSISTANT_KEEP_ALIVE = '30m';

function assistantEnabled() {
  return settings.assistant && settings.assistant.provider === 'ollama' && Boolean(settings.assistant.url) && Boolean(settings.assistant.model);
}

// Ce que le modèle a le droit de savoir : exactement ce qu'Ọjà sait, rien de plus.
function assistantContext(product) {
  const rules = {
    boutique: shopProfile.shopName,
    horaires: shopProfile.hours || null,
    livraison: deliveryAvailable() ? { zone: shopProfile.deliveryZone, tarif_fcfa: Number(shopProfile.deliveryFee), delai: shopProfile.deliveryDelay || null } : null,
    retrait_en_boutique: true,
    moyens_de_paiement: ['Orange Money', 'Moov Money', 'Wave', 'paiement à la livraison'],
    paiement_echelonne: shopProfile.installmentMin && shopProfile.installmentPercent ? { minimum_fcfa: Number(shopProfile.installmentMin), avance_pourcent: Number(shopProfile.installmentPercent) } : null
  };
  const describe = item => {
    const base = { nom: item.name, categorie: item.category, prix_fcfa: item.price, stock: item.stock };
    if (item.category === 'Vêtements') Object.assign(base, { tailles: item.size.values, couleurs: item.color.values, matiere: item.material || null, genre: item.gender || null, ensemble: item.setContent || null });
    if (item.category === 'Cosmétiques') Object.assign(base, { type: item.productType, teintes: item.shade.active ? item.shade.values : null, formats: item.volume.active ? item.volume.values : null, contenu: item.boxContent || null });
    if (item.category === 'Accessoires') Object.assign(base, { type: item.itemType, couleurs: item.color.values, materiau: item.material || null, formats: item.dimension.active ? item.dimension.values : null });
    return base;
  };
  return { boutique: rules, article_en_discussion: product ? describe(product) : null, autres_articles: products.filter(item => !product || item.id !== product.id).map(describe) };
}

function assistantPrompt(product, history, message, { advice = false } = {}) {
  const context = JSON.stringify(assistantContext(product), null, 0);
  const transcript = history.slice(-8).map(m => `${m.from === 'customer' ? 'Cliente' : 'Ọjà'} : ${m.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`).join('\n');
  return `Tu es Ọjà, l'assistante de vente WhatsApp d'une petite boutique burkinabè. Tu réponds en français, en 1 à 3 phrases courtes et chaleureuses, avec au plus un emoji 🌷.

Il y a deux sortes de questions :

A) QUESTIONS SUR LA BOUTIQUE : prix, stock, disponibilité, tailles ou couleurs proposées, livraison, délais, paiement, horaires, adresse, promotions, échanges.
   Tu réponds UNIQUEMENT avec les DONNÉES ci-dessous. Tu n'inventes jamais un prix, une disponibilité, un délai, une condition ou une adresse.
   Si la réponse n'est pas dans les données : "confident": false et "answer" vide.

B) QUESTIONS DE CONSEIL sur l'article : lavage et entretien, repassage, tenue du tissu, coupe (taille petit ou grand), comment le porter ou l'assortir, utilisation d'un cosmétique, type de peau ou de cheveux, étanchéité, bijou qui noircit, occasion (mariage, bureau…).
   Tu peux utiliser tes connaissances générales, avec prudence :
   - appuie-toi sur la matière ou le type de l'article s'ils figurent dans les données, et dis-le (« Pour un article en coton, … ») ;
   - si tu ne connais pas la matière, reste général (« En général, … ») et conseille de vérifier l'étiquette ;
   - n'affirme jamais comme certain ce que les données ne disent pas sur CET article précis ;
   - grossesse, allergie, problème de peau : conseil prudent, test sur une petite zone, et avis d'un pharmacien ou d'un médecin ;
   - jamais de prix, de stock, de délai ni de promesse dans une réponse de conseil.
   Dans ce cas : "confident": true et "type": "conseil".

Si le message n'a rien à voir avec la boutique ou ses articles : "confident": false.
Tu ne prends pas de commande toi-même (le système s'en charge) : tu réponds seulement à la question posée.
${advice ? '\nINDICE : ce message est une question de CONSEIL (cas B).\n' : ''}
DONNÉES DE LA BOUTIQUE (JSON) :
${context}

CONVERSATION RÉCENTE :
${transcript}

NOUVEAU MESSAGE DE LA CLIENTE :
${message}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour : {"answer": "ta réponse ou une chaîne vide", "confident": true ou false, "type": "boutique" ou "conseil"}`;
}

// Lit la réponse du modèle même s'il l'entoure de texte ou de ```json, et accepte
// "confident": "true" (les petits modèles écrivent parfois le booléen entre guillemets).
function parseAssistantJson(raw) {
  const text = String(raw || '').replace(/```json|```/g, '').trim();
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// Renvoie { answer } (réponse fiable) ou { answer: null, reason } (transférer). Ne lève jamais.
// `reason` explique à la vendeuse pourquoi l'assistant n'a pas répondu : disabled, timeout,
// unreachable, http, invalid, unsure, guard.
async function askAssistant(product, history, message, { advice = false } = {}) {
  if (!assistantEnabled()) return { answer: null, reason: 'disabled' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  try {
    const response = await fetch(`${settings.assistant.url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: settings.assistant.model, prompt: assistantPrompt(product, history, message, { advice }), stream: false, format: 'json', keep_alive: ASSISTANT_KEEP_ALIVE, options: { temperature: 0.2 } })
    });
    if (!response.ok) return { answer: null, reason: 'http', detail: response.status };
    const data = await response.json();
    const parsed = parseAssistantJson(data.response);
    if (!parsed) return { answer: null, reason: 'invalid' };
    const confident = parsed.confident === true || String(parsed.confident).toLowerCase() === 'true';
    if (!confident || typeof parsed.answer !== 'string' || !parsed.answer.trim()) return { answer: null, reason: 'unsure' };
    const answer = sanitizeAssistantAnswer(parsed.answer.trim(), { advice: parsed.type === 'conseil' || advice });
    return answer ? { answer } : { answer: null, reason: 'guard' };
  } catch (error) {
    console.warn('Assistant indisponible :', error && error.message);
    return { answer: null, reason: error && error.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// Message pour la vendeuse (visible dans le simulateur, jamais envoyé à la cliente).
function assistantFailureNote(result) {
  const notes = {
    timeout: `Assistant : pas de réponse en ${ASSISTANT_TIMEOUT_MS / 1000} s (le modèle démarre peut-être, réessayez) → transfert`,
    unreachable: 'Assistant : Ollama injoignable (est-il lancé ? voir Réglages → Tester la connexion) → transfert',
    http: `Assistant : erreur Ollama ${result.detail || ''} (le modèle est-il installé ? ollama pull ${settings.assistant ? settings.assistant.model : 'qwen2.5:7b'}) → transfert`,
    invalid: 'Assistant : réponse illisible du modèle → transfert',
    unsure: 'Assistant : pas sûr de sa réponse → transfert',
    guard: 'Assistant : réponse refusée par le garde-fou (montant non vérifié) → transfert'
  };
  return notes[result.reason] || null;
}

// Charge le modèle en mémoire sans rien demander (prompt vide) : la vraie première question
// répond ensuite en quelques secondes. Silencieux en cas d'échec.
function warmUpAssistant() {
  if (!assistantEnabled()) return;
  fetch(`${settings.assistant.url.replace(/\/$/, '')}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.assistant.model, prompt: '', keep_alive: ASSISTANT_KEEP_ALIVE }) }).catch(() => {});
}

// Pastille « Assistant Ollama activé » au-dessus du téléphone.
function renderAssistantBadge() {
  const badge = document.querySelector('#assistant-badge');
  if (badge) badge.classList.toggle('hidden', !assistantEnabled());
}

// Garde-fous côté client :
//  - un montant en FCFA absent des données -> refus (le modèle a inventé un prix) ;
//  - une réponse de conseil ne cite jamais de montant (un conseil ne parle pas d'argent).
function sanitizeAssistantAnswer(answer, { advice = false } = {}) {
  const known = new Set([...products.map(item => Number(item.price)), Number(shopProfile.deliveryFee || NaN), Number(shopProfile.installmentMin || NaN)].filter(n => !Number.isNaN(n)));
  const amounts = [...answer.matchAll(/(\d[\d\s\u202f.]*)\s*(?:f\s?cfa|fcfa|francs?)/gi)].map(m => Number(m[1].replace(/[\s\u202f.]/g, '')));
  if (amounts.some(amount => !known.has(amount))) return null;
  if (advice && amounts.length) return null;
  return esc(answer).replace(/\n/g, '<br>');
}

// ---------- Réglages ----------
function renderAssistantSettings() {
  const assistant = settings.assistant || { provider: 'none', url: 'http://localhost:11434', model: 'qwen2.5:7b' };
  document.querySelector('#assistant-provider').value = assistant.provider || 'none';
  document.querySelector('#assistant-url').value = assistant.url || 'http://localhost:11434';
  document.querySelector('#assistant-model').value = assistant.model || 'qwen2.5:7b';
  document.querySelector('#assistant-fields').classList.toggle('hidden', assistant.provider !== 'ollama');
  document.querySelector('#assistant-status').textContent = '';
}

function saveAssistantSettings() {
  settings.assistant = {
    provider: document.querySelector('#assistant-provider').value,
    url: document.querySelector('#assistant-url').value.trim() || 'http://localhost:11434',
    model: document.querySelector('#assistant-model').value.trim() || 'qwen2.5:7b'
  };
  saveSettings();
  document.querySelector('#assistant-fields').classList.toggle('hidden', settings.assistant.provider !== 'ollama');
  const saved = document.querySelector('#assistant-saved');
  if (saved) saved.textContent = settings.assistant.provider === 'ollama' ? '✓ Enregistré : l\'assistant Ollama est activé. Testez la connexion ci-dessous.' : '✓ Enregistré : assistant désactivé, Ọjà transfère ce qu\'il ne sait pas.';
  renderAssistantBadge();
  warmUpAssistant();
}

async function testAssistantConnection() {
  const status = document.querySelector('#assistant-status');
  saveAssistantSettings();
  status.textContent = 'Connexion…';
  try {
    const response = await fetch(`${settings.assistant.url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    const names = (data.models || []).map(m => m.name);
    const has = names.some(name => name === settings.assistant.model || name.startsWith(`${settings.assistant.model}:`));
    if (!has) { status.textContent = `Connecté, mais le modèle « ${settings.assistant.model} » n'est pas installé (ollama pull ${settings.assistant.model}). Modèles présents : ${names.join(', ') || 'aucun'}.`; return; }
    status.textContent = `Connecté. Modèle « ${settings.assistant.model} » disponible. Chargement du modèle en mémoire…`;
    const started = Date.now();
    const probe = await askAssistant(null, [], 'Bonjour, ça se lave en machine ?', { advice: true });
    const seconds = Math.round((Date.now() - started) / 1000);
    status.textContent = probe.answer
      ? `Connecté. Modèle « ${settings.assistant.model} » disponible et prêt (réponse d'essai en ${seconds} s).`
      : `Connecté. Modèle « ${settings.assistant.model} » disponible. Réponse d'essai : ${(assistantFailureNote(probe) || probe.reason).replace(/^Assistant : /, '').replace(/ → transfert$/, '')} (${seconds} s).`;
  } catch {
    status.textContent = 'Ollama injoignable. Vérifiez qu\'il tourne (OLLAMA_ORIGINS="*" ollama serve) et l\'adresse.';
  }
}
