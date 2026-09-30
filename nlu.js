// =====================================================================================
// nlu.js — Compréhension du langage naturel (côté client, sans dépendance)
//
// Rôle : transformer un message libre de la cliente en (1) intentions scorées et
// (2) entités extraites (couleur, taille, quantité, mode de livraison, moyen de paiement,
// nom). Ce module ne connaît ni le DOM ni le catalogue : il reçoit du texte et renvoie
// des structures. C'est dialogue.js qui décide quoi en faire.
//
// Principes :
//  - Normalisation robuste (minuscules, accents supprimés, apostrophes/ponctuation unifiées)
//    pour que « vidéo », « video » et « VIDÉO » soient une seule chose.
//  - Correspondance par mot entier, pas par sous-chaîne (« vert » ≠ « ouvert »).
//  - Tolérance aux fautes légères : distance de Levenshtein ≤ 1 sur les mots-clés
//    d'au moins 7 lettres (« livraisson », « horraires »).
//  - Chaque intention reçoit un score ; plusieurs intentions peuvent coexister dans un
//    même message (« c'est en quelle matière et vous livrez où ? »).
// =====================================================================================

const NLU = (() => {
  // ---------- Normalisation ----------
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // accents
      .replace(/[’‘`´]/g, "'")                              // apostrophes typographiques
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .replace(/(^|[^a-z0-9])(l|d|j|m|c|n|s|t|qu)'(?=[a-z])/g, '$1') // élisions : « l'avez » -> « avez », « d'autres » -> « autres »
      .replace(/[^a-z0-9 ]+/g, ' ')                         // ponctuation -> espace
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(normalized) {
    return normalized.split(/\s+/).filter(Boolean);
  }

  // ---------- Distance de Levenshtein (petite, itérative) ----------
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // ---------- Correspondance d'un mot-clé (mot entier, pluriel toléré, fautes légères) ----------
  const WORD = "a-z0-9";
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function matchesKeyword(normalized, keyword) {
    const key = normalize(keyword);
    if (!key) return false;
    const exact = new RegExp(`(^|[^${WORD}])${escapeRegex(key)}s?([^${WORD}]|$)`);
    if (exact.test(normalized)) return true;
    // Tolérance aux fautes : uniquement pour les mots-clés simples et assez longs.
    if (key.includes(' ') || key.length < 7) return false;
    return tokens(normalized).some(tok => { const t = tok.replace(/s$/, ''); return Math.abs(t.length - key.length) <= 1 && levenshtein(t, key) <= 1; });
  }

  // ---------- Intentions ----------
  // Chaque intention : liste de mots-clés pondérés. Le score d'une intention est la somme des
  // poids des mots-clés trouvés ; une intention est retenue si son score ≥ 1.
  // `priority` sert d'ordre de réponse quand plusieurs intentions sont présentes.
  const INTENTS = [
    { id: 'human',        priority: 0,  keywords: [['parler a la boutique', 2], ['parler a la vendeuse', 2], ['parler a josie', 2], ['un humain', 2], ['une vraie personne', 2], ['la vendeuse', 1], ['la patronne', 1], ['la gerante', 1], ['quelqu un', 2], ['il y a quelqu', 2], ['le numero', 1], ['votre numero', 1]] },
    { id: 'installment',  priority: 1,  keywords: [['2 fois', 2], ['deux fois', 2], ['3 fois', 2], ['trois fois', 2], ['4 fois', 2], ['echelonne', 2], ['plusieurs fois', 2], ['payer en plusieurs', 2], ['facilite de paiement', 2], ['avance', 1], ['acompte', 2], ['tranche', 1]] },
    { id: 'color',        priority: 2,  keywords: [['couleur', 1], ['coloris', 1], ['teinte', 1], ['nuance', 1]] },
    { id: 'size',         priority: 3,  keywords: [['taille', 1], ['pointure', 1], ['tailles', 1], ['mesure', 1], ['ca taille', 1]] },
    { id: 'price',        priority: 4,  keywords: [['prix', 1], ['combien ca coute', 2], ['est combien', 2], ['combien ca', 1], ['ce combien', 2], ['combien', 0.5], ['ca coute', 1], ['baisser', 1], ['coute', 1], ['tarif', 1], ['fcfa', 1], ['cout', 1], ['moins cher', 1], ['reduction', 1], ['promo', 1], ['promotion', 1], ['negocier', 1], ['dernier prix', 2]] },
    { id: 'stock',        priority: 5,  keywords: [['disponible', 1], ['dispo', 1], ['en stock', 2], ['il reste', 1], ['il en reste', 2], ['ca reste', 2], ['reste', 0.5], ['encore la', 2], ['encore', 0.5], ['toujours', 0.5], ['rupture', 1]] },
    { id: 'photos',       priority: 6,  keywords: [['photo autres', 2], ['photos autres', 2], ['photo de clientes', 2], ['photos de clientes', 2], ['avis client', 2], ['autres clientes', 2], ['autres photos', 2], ['autre photo', 2], ['autres photos', 2], ['plus de photos', 2], ['la photo', 1], ['envoie', 0.5], ['envoyer', 0.5], ['photo', 0.5], ['photos', 0.5], ['image', 0.5]] },
    { id: 'worn',         priority: 7,  keywords: [['porte', 1], ['portee', 1], ['sur elle', 1], ['sur une personne', 1], ['sur un mannequin', 1], ['mannequin', 1], ['sur quelqu un', 1], ['sur quelqu', 1]] },
    { id: 'video',        priority: 8,  keywords: [['video', 1], ['petite video', 1], ['clip', 1], ['en mouvement', 1]] },
    { id: 'material',     priority: 9,  keywords: [['matiere', 1], ['tissu', 1], ['qualite', 1], ['solide', 1], ['ca dure', 1], ['authentique', 1], ['original', 1], ['materiau', 1], ['composition', 1], ['ingredient', 1], ['ingredients', 1], ['contrefacon', 1], ['du vrai', 2], ['vrai', 0.5], ['fait en quoi', 2], ['en quoi', 1]] },
    // Conseil d'usage ou d'entretien : une question de connaissance générale sur l'article, pas sur la
    // boutique. Poids 2 : elle l'emporte sur « matière », « taille » ou « porté » quand le message en
    // parle (« le tissu est transparent ? », « ça taille petit ? », « ça se porte avec quoi ? »).
    // dialogue.js la confie à l'assistant local (Ollama) quand il est activé.
    { id: 'advice',       priority: 9.5, keywords: [
      ['lave', 2], ['laver', 2], ['lavage', 2], ['lavable', 2], ['machine', 2], ['a la main', 1], ['repasser', 2], ['repassage', 2], ['retrecit', 2], ['retrecir', 2], ['retreci', 2], ['deteint', 2], ['deteindre', 2], ['decolore', 2], ['froisse', 2], ['secher', 1], ['seche linge', 2], ['entretien', 2], ['entretenir', 2], ['nettoyer', 2], ['pressing', 2],
      ['transparent', 2], ['transparente', 2], ['epais', 2], ['epaisse', 2], ['tient chaud', 2], ['respirant', 2], ['gratte', 2], ['bouloche', 2], ['boulocher', 2], ['extensible', 2], ['elastique', 2], ['stretch', 2],
      ['taille petit', 2], ['taille grand', 2], ['taille normalement', 2], ['taille normal', 2], ['taille au dessus', 2], ['taille en dessous', 2], ['kg', 2], ['kilos', 2], ['je mesure', 2],
      ['peau grasse', 2], ['peaux grasses', 2], ['peau seche', 2], ['peaux seches', 2], ['peau sensible', 2], ['peaux sensibles', 2], ['peau mixte', 2], ['peau noire', 2], ['cheveux crepus', 2], ['utilise', 2], ['utiliser', 2], ['utilisation', 2], ['applique', 2], ['appliquer', 2], ['combien de fois', 2], ['enceinte', 2], ['allaitante', 2], ['allergie', 2], ['allergique', 2], ['irrite', 2], ['acne', 2], ['boutons', 1], ['taches', 1], ['eclaircit', 2], ['eclaircissant', 2], ['depigmentant', 2], ['se conserve', 2], ['conserver', 2], ['odeur', 2], ['sent bon', 2],
      ['impermeable', 2], ['etanche', 2], ['resiste a eau', 2], ['sous la douche', 2], ['noircit', 2], ['noircir', 2], ['rouille', 2], ['oxyde', 2], ['nickel', 2], ['plaque or', 2],
      ['se porte avec', 2], ['porter avec', 2], ['assortir', 2], ['va avec', 2], ['convient', 2], ['conviendrait', 2], ['pour un mariage', 2], ['pour une ceremonie', 2], ['pour le bureau', 2], ['conseil', 2], ['conseillez', 2], ['conseiller', 2], ['comment porter', 2], ['comment on', 1], ['sert a quoi', 2], ['ca sert', 2]
    ] },
    { id: 'hours',        priority: 10, keywords: [['horaire', 1], ['ouvert', 1], ['ouverte', 1], ['ferme', 1], ['fermee', 1], ['quelle heure', 1], ['vous etes ouverts', 2], ['ouverture', 1], ['fermeture', 1], ['dimanche', 0.5]] },
    { id: 'delivery',     priority: 11, keywords: [['livraison', 1], ['livraison est combien', 3], ['livraison combien', 3], ['livrez', 1], ['livrer', 1], ['livre', 0.5], ['delai', 1], ['combien de temps', 1.5], ['ca arrive', 1], ['arrive', 0.5], ['ca met combien', 1], ['quand est ce que', 0.5], ['a domicile', 1], ['expedier', 1], ['expedition', 1], ['envoyer', 0.5], ['zone', 0.5], ['quartier', 0.5]] },
    { id: 'pickup',       priority: 12, keywords: [['retrait', 1], ['retirer', 1], ['passer a la boutique', 2], ['venir chercher', 2], ['venir voir', 2], ['venir', 0.5], ['magasin', 1], ['sur place', 1], ['ou etes vous', 1], ['vous etes ou', 2], ['ou est la boutique', 2], ['adresse', 1], ['situe', 1], ['situee', 1], ['localisation', 1]] },
    { id: 'payment',      priority: 13, keywords: [['orange money', 2], ['orange', 1], ['moov money', 2], ['moov', 1], ['wave', 1], ['payer', 1], ['paiement', 1], ['comment payer', 2], ['peux payer', 1], ['a la livraison', 1.5], ['payer avant', 2], ['avant de payer', 1], ['moyen de paiement', 2], ['especes', 1], ['cash', 1]] },
    { id: 'order',        priority: 14, keywords: [['commander', 1], ['je commande', 2], ['la commande', 0.5], ['je prends', 2], ['je la prends', 2], ['je le prends', 2], ['acheter', 1], ['je veux', 0.5], ['je voudrais', 0.5], ['en veux', 1], ['en voudrais', 1], ['il me faut', 1], ['interesse', 1], ['est bon', 0.5], ['ok pour', 1], ['on valide', 2], ['je valide', 2], ['reserver', 1]] },
    { id: 'thanks',       priority: 15, keywords: [['merci', 1], ['thanks', 1], ['super', 0.5], ['parfait', 0.5], ['top', 0.5], ['genial', 0.5]] },
    { id: 'greeting',     priority: 16, keywords: [['bonjour', 1], ['bonsoir', 1], ['salut', 1], ['hello', 1], ['coucou', 1], ['bjr', 1], ['slt', 1]] },
    { id: 'info',         priority: 17, keywords: [['des infos', 1], ['information', 1], ['informations', 1], ['renseignement', 1], ['renseignements', 1], ['en savoir plus', 2], ['details', 1], ['detail', 1], ['decrire', 1], ['description', 1], ['est quoi', 1], ['ca ressemble', 1]] },
    { id: 'doubt',        priority: 18, keywords: [['un doute', 2], ['pas sur', 1], ['pas sure', 1], ['hesite', 1], ['hesite', 1], ['confiance', 1], ['arnaque', 2], ['serieux', 1], ['fiable', 1]] },
    { id: 'negative',     priority: 19, keywords: [['non', 1], ['pas ca', 1], ['laisse tomber', 2], ['annule', 1], ['annuler', 1], ['finalement non', 2], ['plus interessee', 2], ['je ne veux plus', 2]] },
    { id: 'affirmative',  priority: 20, keywords: [['oui', 1], ['ok', 1], ['accord', 1], ['daccord', 1], ['est bon', 1], ['ca marche', 1], ['bien sur', 1], ['volontiers', 1], ['exact', 1], ['tout a fait', 1]] }
  ];

  const ADVICE_OVERRIDES = new Set(['material', 'size', 'worn', 'info', 'order', 'affirmative']);

  // Faux amis : un mot-clé présent, mais une autre question. On retire l'intention qu'il déclenche.
  //  - « sur mesure » : confection à la demande, pas une question de taille ;
  //  - « ma commande d'hier est arrivée où ? » : suivi d'une commande passée, pas un nouvel achat.
  // Sans intention reconnue, le message part à l'assistant local (ou à la vendeuse s'il est
  // désactivé) : Ọjà n'a ni suivi de commande ni information sur le sur-mesure.
  const FALSE_FRIENDS = [
    { intent: 'size', pattern: /\bsur mesure\b/ },
    { intent: 'order', pattern: /\b(ma|mon|notre) commande\b.*\b(arrive|arrivee|ou|recu|recue|livre|livree|suivi|en est|toujours|pas encore)\b|\bcommande (d hier|de la semaine|passee|de la derniere)\b|\bsuivi (de )?(ma |la )?commande\b|\bou (en )?est (ma|mon|notre) commande\b/ }
  ];

  function detectIntents(message) {
    const normalized = normalize(message);
    const found = [];
    for (const intent of INTENTS) {
      let score = 0;
      const hits = [];
      for (const [keyword, weight] of intent.keywords) {
        if (matchesKeyword(normalized, keyword)) { score += weight; hits.push(keyword); }
      }
      if (score >= 1) found.push({ id: intent.id, score, priority: intent.priority, hits });
    }
    // Une question de conseil l'emporte sur les intentions voisines que ses mots déclenchent
    // aussi (« ça taille petit ? » n'est pas une demande de tailles, « c'est bon pour les peaux
    // grasses ? » n'est pas un « oui », « ça se porte avec quoi ? » ne demande pas de photo).
    const falseFriends = new Set(FALSE_FRIENDS.filter(rule => rule.pattern.test(normalized)).map(rule => rule.intent));
    const real = found.filter(intent => !falseFriends.has(intent.id));
    const kept = real.some(intent => intent.id === 'advice') ? real.filter(intent => !ADVICE_OVERRIDES.has(intent.id)) : real;
    // Score décroissant, puis priorité de réponse.
    return kept.sort((a, b) => b.score - a.score || a.priority - b.priority);
  }

  // ---------- Entités ----------
  const COLOR_WORDS = ['noir', 'rouge', 'bleu', 'vert', 'jaune', 'blanc', 'rose', 'gris', 'marron', 'beige', 'violet', 'orange', 'bordeaux', 'dore', 'argent', 'argente', 'kaki', 'turquoise', 'corail', 'nude', 'camel', 'fuchsia', 'ivoire', 'creme', 'bleu ciel', 'bleu marine', 'marine', 'or'];
  const SIZE_SYNONYMS = { 'small': 'S', 'petit': 'S', 'petite': 'S', 'medium': 'M', 'moyen': 'M', 'moyenne': 'M', 'large': 'L', 'grand': 'L', 'grande': 'L', 'xlarge': 'XL', 'tres grand': 'XL', 'tres grande': 'XL' };
  const NUMBER_WORDS = { 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10 };

  function extractColors(normalized) {
    // Les couleurs composées d'abord (« bleu marine » avant « bleu »).
    const sorted = [...COLOR_WORDS].sort((a, b) => b.length - a.length);
    const out = [];
    for (const color of sorted) {
      if (matchesKeyword(normalized, color) && !out.some(c => c.includes(color) || color.includes(c))) out.push(color);
    }
    return out;
  }

  function extractSizes(normalized) {
    const out = [];
    // Tailles lettres : s, m, l, xl, xxl, xs, 3xl... comme mots entiers.
    // Une lettre seule (S, M, L) est ambiguë : on ne la retient que si le message est très court
    // (« M », « la M ») ou si elle est introduite par un mot de taille (« en M », « taille L »,
    // « je fais du S »). Ainsi le « m » de « -m http.server » ou de « 2 m de tissu » est ignoré ;
    // les formes à préfixe (XL, XXL, XS…) restent reconnues partout.
    const short = tokens(normalized).length <= 4;
    const letterRe = /(^|[^a-z0-9])(x{0,3}s|x{0,3}l|m|[2-5]xl)([^a-z0-9]|$)/g;
    let m;
    while ((m = letterRe.exec(normalized))) {
      const size = m[2].toUpperCase();
      if (size.length > 1 || short) { out.push(size); continue; }
      const before = normalized.slice(0, m.index + m[1].length).trim().split(/\s+/).slice(-1)[0] || '';
      if (['en', 'taille', 'tailles', 'du', 'la', 'le', 'une', 'un', 'fais', 'prends', 'plutot', 'ou'].includes(before)) out.push(size);
    }
    // Tailles numériques (36, 38, 40, 85b, 90c...) entre 30 et 130, évitant les montants FCFA.
    const numRe = /(^|[^a-z0-9])(\d{2,3}[a-e]?)([^a-z0-9]|$)/g;
    while ((m = numRe.exec(normalized))) {
      const n = parseInt(m[2], 10);
      if (n >= 30 && n <= 130) out.push(m[2].toUpperCase());
    }
    for (const [word, size] of Object.entries(SIZE_SYNONYMS)) {
      if (matchesKeyword(normalized, word)) out.push(size);
    }
    return [...new Set(out)];
  }

  function extractQuantity(normalized) {
    let m = normalized.match(/(?:^|\s)x\s?(\d{1,2})(?:\s|$)/) || normalized.match(/(?:^|\s)(\d{1,2})\s?(?:x|pieces?|exemplaires?|unites?|articles?)(?:\s|$)/);
    if (m) return parseInt(m[1], 10);
    m = normalized.match(/(?:en veux|je veux|je prends|il me faut|donnez moi|mettez moi|je voudrais|en voudrais|en prends)\s+(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)(?:\s|$)/);
    if (m) return NUMBER_WORDS[m[1]] || parseInt(m[1], 10);
    return null;
  }

  function extractDeliveryMode(normalized) {
    if (/(^|\s)(livraison|livrer|livrez|a domicile|chez moi|a la maison|me livrer)(\s|$)/.test(normalized)) return 'delivery';
    if (/(^|\s)(retrait|retirer|sur place|en boutique|a la boutique|je passe|je viens|venir chercher|passer)(\s|$)/.test(normalized)) return 'pickup';
    return null;
  }

  function extractPayment(normalized) {
    if (/(^|\s)orange(\s|$)/.test(normalized)) return 'orange';
    if (/(^|\s)moov(\s|$)/.test(normalized)) return 'moov';
    if (/(^|\s)wave(\s|$)/.test(normalized)) return 'wave';
    if (/(^|\s)(cash|especes|liquide|a la livraison|a la reception|en main propre)(\s|$)/.test(normalized)) return 'cash';
    return null;
  }

  // Nom : « je m'appelle X », « moi c'est X », « c'est X », « mon nom est X », ou un message
  // court sans autre intention (1 à 4 mots) quand on vient justement de demander le nom.
  function extractName(rawMessage, { expectingName = false, intents = [] } = {}) {
    const text = String(rawMessage || '').trim().replace(/[.!?]+$/, '');
    const patterns = [/je m[’' ]?appelle\s+(.+)/i, /moi c[’' ]?est\s+(.+)/i, /mon nom (?:c[’' ]?est|est)\s+(.+)/i, /^c[’' ]?est\s+(.+)/i, /^je suis\s+(.+)/i];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return titleCase(m[1].trim());
    }
    if (expectingName && !intents.length) {
      const words = text.split(/\s+/);
      if (words.length >= 1 && words.length <= 4 && /^[\p{L}\p{M}' .-]+$/u.test(text)) return titleCase(text);
    }
    return null;
  }

  function titleCase(name) {
    return name.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  }

  // Fait correspondre un message à une valeur du catalogue (taille, couleur, teinte, volume…).
  // Ordre d'essai : égalité normalisée > valeur contenue dans le message (mot entier) >
  // message contenu dans la valeur > synonymes de taille > distance ≤ 1 pour les valeurs longues.
  function matchValue(message, values) {
    const normalized = normalize(message);
    const cleaned = normalized.replace(/^(je prends|je veux|je voudrais|plutot|en|la|le|du|de la|taille|couleur)\s+/g, '').trim();
    const candidates = values.filter(Boolean);
    const byExact = candidates.find(v => normalize(v) === cleaned || normalize(v) === normalized);
    if (byExact) return byExact;
    const byWord = candidates.find(v => matchesKeyword(normalized, normalize(v)));
    if (byWord) return byWord;
    const byContains = candidates.find(v => cleaned.length >= 2 && normalize(v).includes(cleaned));
    if (byContains) return byContains;
    const compact = normalized.replace(/\s+/g, '');
    const byCompact = candidates.find(v => { const nv = normalize(v).replace(/\s+/g, ''); return nv.length >= 2 && compact.includes(nv); });
    if (byCompact) return byCompact;
    const sizes = extractSizes(normalized);
    const bySize = candidates.find(v => sizes.includes(String(v).toUpperCase()));
    if (bySize) return bySize;
    const byFuzzy = candidates.find(v => { const nv = normalize(v); return nv.length >= 5 && tokens(normalized).some(t => levenshtein(t, nv) <= 1); });
    return byFuzzy || null;
  }

  function analyze(message) {
    const normalized = normalize(message);
    const intents = detectIntents(message);
    const payment = extractPayment(normalized);
    // « orange » dans « Orange Money » n'est pas une couleur.
    const colors = extractColors(normalized).filter(color => !(color === 'orange' && payment === 'orange'));
    return {
      raw: message,
      normalized,
      intents,
      entities: {
        colors,
        sizes: extractSizes(normalized),
        quantity: extractQuantity(normalized),
        deliveryMode: extractDeliveryMode(normalized),
        payment
      }
    };
  }

  return { normalize, tokens, levenshtein, matchesKeyword, detectIntents, analyze, matchValue, extractName, extractColors, extractSizes, extractQuantity, extractDeliveryMode, extractPayment, COLOR_WORDS, INTENTS };
})();
