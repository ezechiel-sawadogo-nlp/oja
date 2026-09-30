// =====================================================================================
// dialogue.js — Moteur de conversation Ọjà
//
// Un seul moteur pour toutes les catégories. Ce qui varie d'une catégorie à l'autre
// (quels attributs demander, comment formuler, quel mot pour « gamme ») est décrit dans
// DOMAIN_SCHEMAS ; le moteur lui-même ne connaît ni les robes ni les rouges à lèvres.
//
// Cycle d'une conversation :
//   attributs à choisir (taille, couleur, teinte, format…) -> nom -> livraison/retrait ->
//   paiement -> commande enregistrée -> clôture (+ suggestion de gamme)
//
// À chaque étape, `dialogue.pending` décrit la question posée. C'est ce qui permet au
// texte libre d'être interprété en contexte : « M » répond à la question de taille,
// « Aïssata » à la question du nom, « à domicile » à la question de livraison.
//
// Règle absolue (cahier des charges) : Ọjà n'invente jamais un prix, une disponibilité ou
// une condition de vente. Quand l'information manque, il transfère à la vendeuse.
//
// Dépendances (définies dans app.js, disponibles à l'exécution) : addReply, addIncoming,
// setChoices, addImageReply, addVideoReply, escalateToShop, money, esc, shopProfile,
// products, orders, save, orderKey, renderOrders, showToast, getOrCreateCustomerId,
// deliveryAvailable, splitProductPhotos, suggestions.
// =====================================================================================

// ---------- Petits utilitaires de formulation ----------
function shopName() { return esc(shopProfile.shopName || 'Josie Style'); }
function listValues(values) { return values.filter(Boolean).map(esc).join(', '); }
function joinFr(segments) {
  if (segments.length <= 1) return segments.join('');
  return `${segments.slice(0, -1).join(', ')}, et ${segments[segments.length - 1]}`;
}
function hasChoices(field) { return Boolean(field) && Array.isArray(field.values) && Boolean(field.values.filter(Boolean).length); }

// ---------- Descripteurs d'attributs ----------
// Un attribut = un champ du produit de la forme { mode:'unique'|'plusieurs', values:[…], active? }.
//   key            : nom du champ dans le produit (size, color, shade, volume, dimension…)
//   label          : mot français pour les messages génériques
//   isActive(p)    : l'attribut existe-t-il pour ce produit ? (cosmétiques : champ .active)
//   announceUnique : phrase d'intro quand une seule valeur
//   question       : question quand cet attribut est demandé seul
//   segment        : fragment « en A, B » pour les questions groupées
//   missing        : bouton « Une autre couleur » + réponse honnête
//   detail(v)      : comment la valeur apparaît dans le récapitulatif de commande
//   entity         : quelle entité NLU (colors / sizes) peut répondre à cette question
function makeColorAttr({ pronoun = 'Il', word = 'couleur', altWord = 'teinte' }) {
  return {
    key: 'color', label: word, entity: 'colors',
    isActive: () => true,
    announceUnique: p => `${pronoun} est disponible en ${esc(p.color.values[0])}.`,
    question: p => `${pronoun} est disponible en ${listValues(p.color.values)}. Laquelle préférez-vous ?`,
    segment: p => `en ${listValues(p.color.values)}`,
    missing: { id: 'color-missing', label: `Une autre ${word}`, reply: p => `Non, celui-ci n'existe pas dans une autre ${altWord}, mais nous l'avons en ${listValues(p.color.values)}.` },
    detail: v => v
  };
}

const CLOTHES_SIZE_ATTR = {
  key: 'size', label: 'taille', entity: 'sizes',
  isActive: () => true,
  announceUnique: p => {
    const value = esc(p.size.values[0]);
    if (p.size.sizeType === 'Soutien-gorge') return `Cet article est disponible dans la taille ${value}.`;
    if (p.size.sizeType === 'Culotte-bas') return `Cet article est disponible en ${value}.`;
    return `Cet article est disponible en taille ${value}.`;
  },
  question: p => {
    const values = listValues(p.size.values);
    if (p.size.sizeType === 'Soutien-gorge') return `Cet article est disponible dans les tailles ${values}. Quel est votre tour de bonnet ?`;
    return `Cet article est disponible en ${p.size.sizeType === 'Culotte-bas' ? '' : 'tailles '}${values}. Laquelle vous conviendrait ?`;
  },
  segment: p => `en tailles ${listValues(p.size.values)}`,
  detail: v => `Taille ${v}`
};

function makeCosmeticAttr(key, { question, missing = null, entity = null }) {
  return {
    key, label: key, entity,
    isActive: p => Boolean(p[key] && p[key].active),
    announceUnique: p => `Il est disponible en ${esc(p[key].values[0])}.`,
    question: p => `Il est disponible en ${listValues(p[key].values)}. ${question}`,
    segment: p => `en ${listValues(p[key].values)}`,
    missing,
    detail: v => v
  };
}

const ACCESSORY_DIMENSION_ATTR = {
  key: 'dimension', label: 'format', entity: 'sizes',
  isActive: p => Boolean(p.dimension && p.dimension.active),
  announceUnique: p => p.dimension.dimensionType === 'Taille-bague' ? `Il est disponible en taille ${esc(p.dimension.values[0])}.` : `Il est disponible en ${esc(p.dimension.values[0])}.`,
  question: p => p.dimension.dimensionType === 'Taille-bague'
    ? `Il est disponible en tailles ${listValues(p.dimension.values)}. Quelle est votre taille de bague ?`
    : `Il est disponible en ${listValues(p.dimension.values)}. Lequel vous conviendrait ?`,
  segment: p => p.dimension.dimensionType === 'Taille-bague' ? `en tailles ${listValues(p.dimension.values)}` : `en ${listValues(p.dimension.values)}`,
  detail: v => v
};

// ---------- Schémas par catégorie ----------
const DOMAIN_SCHEMAS = {
  'Vêtements': {
    isStructured: p => Boolean(p.size),
    intro: p => {
      let text = `${esc(p.name)} est disponible à <strong>${money(p.price)}</strong>. Cet article est en ${esc(p.material)}${p.gender ? `, pour ${esc(p.gender.toLowerCase())}` : ''}.`;
      if (p.setContent) text += ` L'ensemble comprend : ${esc(p.setContent)}.`;
      return text;
    },
    attributes: [makeColorAttr({ pronoun: 'Cet article' }), CLOTHES_SIZE_ATTR],
    groupedQuestion: null,          // Vêtements : une question à la fois (couleur puis taille)
    rangeWord: 'collection',
    extras: () => []
  },
  'Cosmétiques': {
    isStructured: p => p.productType !== undefined,
    intro: p => {
      let text = `${esc(p.name)} (${esc(p.productType)}) est disponible à <strong>${money(p.price)}</strong>.`;
      if (p.boxContent) text += ` Le coffret comprend : ${esc(p.boxContent)}.`;
      return text;
    },
    attributes: [
      makeCosmeticAttr('shade', { question: 'Laquelle préférez-vous ?', entity: 'colors', missing: { id: 'shade-missing', label: 'Une autre teinte', reply: p => `Non, celui-ci n'existe pas dans une autre teinte, mais nous l'avons en ${listValues(p.shade.values)}.` } }),
      makeCosmeticAttr('volume', { question: 'Lequel vous conviendrait ?' }),
      makeCosmeticAttr('length', { question: 'Laquelle préférez-vous ?', entity: 'sizes' }),
      makeCosmeticAttr('texture', { question: 'Laquelle préférez-vous ?' })
    ],
    groupedQuestion: (p, pending) => `Il est disponible ${joinFr(pending.map(a => a.segment(p)))}. Que préférez-vous ?`,
    rangeWord: 'gamme',
    extras: () => []
  },
  'Accessoires': {
    isStructured: p => p.itemType !== undefined,
    intro: p => {
      let text = `${esc(p.name)} (${esc(p.itemType)}) est disponible à <strong>${money(p.price)}</strong>.`;
      if (p.packContent) text += ` Le pack comprend : ${esc(p.packContent)}.`;
      return text;
    },
    attributes: [makeColorAttr({ pronoun: 'Il', altWord: 'couleur' }), ACCESSORY_DIMENSION_ATTR],
    groupedQuestion: (p) => {
      const colors = listValues(p.color.values);
      const values = listValues(p.dimension.values);
      if (p.dimension.dimensionType === 'Taille-bague') return `Il est disponible en ${colors}, en tailles ${values}. Quelle couleur et quelle taille de bague préférez-vous ?`;
      return `Il est disponible en ${colors}, et en ${values}. Que préférez-vous ?`;
    },
    rangeWord: 'gamme',
    extras: p => p.material ? [{ id: 'material', label: 'Quel est le matériau ?' }] : []
  }
};

function getSchema(product) {
  if (!product) return null;
  const schema = DOMAIN_SCHEMAS[product.category];
  return schema && schema.isStructured(product) ? schema : null;
}

// ---------- État de la conversation ----------
const PAYMENT_LABELS = { orange: 'Orange Money', moov: 'Moov Money', wave: 'Wave', cash: 'paiement à la livraison' };
const REASSURANCE_TEXT = () => `Je comprends tout à fait votre prudence 🌷 Mais chez ${shopName()}, notre politique est basée sur la qualité de nos articles et la satisfaction du client, vous pouvez nous faire confiance. Souhaitez-vous que je vous montre d'autres photos, ou préférez-vous que la boutique vous réponde directement ?`;

let dialogue = freshDialogue(null);

function freshDialogue(product) {
  return {
    product,
    schema: getSchema(product),
    chosen: {},              // { color:'Beige', size:'M', shade:'Rouge', … }
    quantity: 1,
    cart: [],                // articles déjà choisis : [{ productId, name, price, category, chosen, quantity }]
    cartSummarized: false,   // le récapitulatif panier n'est annoncé qu'une fois, avant le nom
    customerName: null,
    deliveryMode: null,      // 'delivery' | 'pickup'
    payment: null,
    reassuranceUsed: false,
    proposal: null,          // { key, value } proposé par Ọjà, à confirmer par un « oui »
    pending: null            // { type:'attribute', keys:[…] } | { type:'name'|'delivery'|'payment'|'closed' }
  };
}

// Compatibilité avec le reste de l'app (escalations, récap) : nom capturé de la cliente.
function currentCustomerName() { return dialogue.customerName; }

// Démarre une conversation complète (message d'accueil + présentation du produit).
function startDialogue(product) {
  dialogue = freshDialogue(product);
  if (!dialogue.schema) return false;
  presetUniqueValues();
  addIncoming(`Bonjour, je suis intéressée par ${esc(product.name)}.`);
  addReply(`Bonjour et bienvenue chez ${shopName()} 🌷 ${introSentences(product)}`);
  askNext();
  return true;
}

// Reprend une conversation déjà entamée (ex. l'exemple statique de démarrage) sans réafficher
// l'accueil, avec des valeurs déjà connues (ex. taille M).
function resumeDialogue(product, preset = {}) {
  dialogue = freshDialogue(product);
  if (!dialogue.schema) return false;
  presetUniqueValues();
  Object.entries(preset).forEach(([key, value]) => { if (product[key] && product[key].values.includes(value)) dialogue.chosen[key] = value; });
  askNext();
  return true;
}

// Attache le moteur à un produit sans rien afficher (l'exemple statique de démarrage montre déjà
// une conversation) : le texte libre et les boutons peuvent alors être interprétés en contexte.
function resumeDialogueSilently(product) {
  dialogue = freshDialogue(product);
  if (dialogue.schema) presetUniqueValues();
  return Boolean(dialogue.schema);
}

function presetUniqueValues() {
  const { product, schema } = dialogue;
  schema.attributes.forEach(attr => {
    if (attr.isActive(product) && product[attr.key].mode === 'unique' && product[attr.key].values[0]) dialogue.chosen[attr.key] = product[attr.key].values[0];
  });
}

// Phrases de présentation du produit (sans l'accueil) : prix + annonce des attributs uniques.
function introSentences(product) {
  const schema = getSchema(product);
  let text = schema.intro(product);
  schema.attributes.forEach(attr => {
    if (attr.isActive(product) && product[attr.key].mode === 'unique' && product[attr.key].values[0]) text += ` ${attr.announceUnique(product)}`;
  });
  return text;
}

function pendingAttributes() {
  const { product, schema } = dialogue;
  return schema.attributes.filter(attr => attr.isActive(product) && product[attr.key].mode === 'plusieurs' && hasChoices(product[attr.key]) && !dialogue.chosen[attr.key]);
}

function baseExtras() {
  const { product, schema } = dialogue;
  const others = otherProducts();
  return [{ id: 'doubt', label: 'J\'ai un doute sur la qualité' }, ...schema.extras(product), ...(others.length ? [{ id: 'add-more', label: 'Ajouter un autre article' }] : []), { id: 'human', label: 'Parler à la boutique' }];
}

// Produits en stock, hors produit courant et hors panier, proposables à l'ajout.
function otherProducts() {
  const inCart = new Set(dialogue.cart.map(item => item.productId));
  return products.filter(item => item.id !== dialogue.product.id && !inCart.has(item.id) && Number(item.stock) > 0 && getSchema(item));
}

// Récapitulatif d'une ligne (article + attributs choisis + quantité).
function lineLabel(product, chosen, quantity) {
  const schema = getSchema(product);
  const parts = schema.attributes.filter(attr => chosen[attr.key]).map(attr => attr.detail(chosen[attr.key]));
  if (quantity > 1) parts.push(`x${quantity}`);
  return product.name + (parts.length ? ` · ${parts.join(' · ')}` : '');
}

// Met l'article courant dans le panier et passe à un autre produit (même conversation, même
// cliente) : les questions d'attributs repartent pour le nouvel article, puis le flux commun
// (nom, livraison, paiement) reprend avec le total du panier.
function switchProduct(next) {
  const { product, chosen, quantity } = dialogue;
  if (pendingAttributes().length === 0) {
    dialogue.cart.push({ productId: product.id, name: product.name, price: product.price, category: product.category, chosen: { ...chosen }, quantity: Math.max(1, quantity || 1) });
  } else {
    addReply(`D'accord, on met ${esc(product.name)} de côté pour l'instant 🌷`);
  }
  dialogue.product = next;
  dialogue.schema = getSchema(next);
  activeProduct = next; // le simulateur suit le nouvel article (sinon app.js réattacherait l'ancien)
  dialogue.chosen = {};
  dialogue.quantity = 1;
  dialogue.proposal = null;
  dialogue.cartSummarized = false;
  presetUniqueValues();
  if (activeThread) { activeThread.productId = next.id; activeThread.productName = dialogue.cart.length ? `${dialogue.cart[0].name} + ${next.name}` : next.name; }
  addReply(`Bien sûr 🌷 ${introSentences(next)}`);
  askNext();
}

function offerOtherProducts() {
  const others = otherProducts().slice(0, 6);
  addReply(`Avec plaisir 🌷 Voici ce que nous avons aussi : ${others.map(item => `${esc(item.name)} (${money(item.price)})`).join(', ')}. Lequel vous intéresse ?`);
  setChoices([...others.map(item => ({ id: `product:${item.id}`, label: item.name })), { id: 'no-more', label: 'Non merci, c\'est tout' }]);
}

// Cherche un autre produit du catalogue nommé dans le message (« je veux aussi le sac Lune »).
function findMentionedProduct(normalized) {
  const stop = new Set(['de', 'du', 'la', 'le', 'les', 'en', 'et', 'a', 'au', 'aux', 'un', 'une', 'des', 'pour', 'satin', 'coffret', 'sac', 'robe']);
  let best = null;
  for (const item of otherProducts()) {
    const words = NLU.tokens(NLU.normalize(item.name)).filter(w => w.length >= 3);
    const distinctive = words.filter(w => !stop.has(w));
    const hits = distinctive.filter(w => NLU.matchesKeyword(normalized, w)).length;
    const fullName = NLU.matchesKeyword(normalized, NLU.normalize(item.name));
    const score = fullName ? 10 : hits;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best ? best.item : null;
}

// Pose la prochaine question nécessaire, dans l'ordre : attributs -> nom -> livraison -> paiement.
function askNext() {
  const { product, schema } = dialogue;
  if (!schema) return;
  const pending = pendingAttributes();
  const extras = baseExtras();
  if (pending.length > 1 && schema.groupedQuestion) {
    addReply(schema.groupedQuestion(product, pending));
    setChoices([
      ...pending.flatMap(attr => product[attr.key].values.filter(Boolean).map(value => ({ id: `${attr.key}:${value}`, label: value }))),
      ...pending.filter(attr => attr.missing).map(attr => ({ id: attr.missing.id, label: attr.missing.label })),
      ...extras
    ]);
    dialogue.pending = { type: 'attribute', keys: pending.map(attr => attr.key) };
    return;
  }
  if (pending.length) {
    const attr = pending[0];
    addReply(attr.question(product));
    setChoices([
      ...product[attr.key].values.filter(Boolean).map(value => ({ id: `${attr.key}:${value}`, label: value })),
      ...(attr.missing ? [{ id: attr.missing.id, label: attr.missing.label }] : []),
      ...extras
    ]);
    dialogue.pending = { type: 'attribute', keys: [attr.key] };
    return;
  }
  if (dialogue.cart.length && !dialogue.cartSummarized) {
    dialogue.cartSummarized = true;
    const lines = [...dialogue.cart.map(item => item.name && lineLabel(products.find(p => p.id === item.productId) || product, item.chosen, item.quantity)), lineLabel(product, dialogue.chosen, dialogue.quantity)];
    addReply(`Votre panier : ${lines.map(esc).join(' + ')} — sous-total <strong>${money(cartTotal())}</strong> 🌷`);
  }
  if (!dialogue.customerName) {
    addReply('Avant de finaliser, quel est votre nom, s\'il vous plaît ?');
    setChoices([...pickSampleNames().map(name => ({ id: `customer-name:${name}`, label: name })), ...extras]);
    dialogue.pending = { type: 'name' };
    return;
  }
  if (!dialogue.deliveryMode) {
    if (deliveryAvailable()) {
      addReply('Souhaitez-vous une livraison à domicile ou un retrait à la boutique ?');
      setChoices([{ id: 'delivery', label: 'Livraison à domicile' }, { id: 'pickup', label: 'Retrait en boutique' }, ...extras]);
    } else {
      addReply(`Je n'ai pas encore les informations de livraison à domicile de la part de ${shopName()}, mais vous pouvez retirer votre commande en boutique.`);
      setChoices([{ id: 'pickup', label: 'Retrait en boutique' }, ...extras]);
    }
    dialogue.pending = { type: 'delivery' };
    return;
  }
  if (!dialogue.payment) {
    setChoices([{ id: 'orange', label: 'Orange Money' }, { id: 'moov', label: 'Moov Money' }, { id: 'wave', label: 'Wave' }, { id: 'cash', label: 'À la livraison' }]);
    dialogue.pending = { type: 'payment' };
  }
}

// Noms d'exemple proposés comme boutons quand Ọjà demande le nom (prototype sans vraie cliente).
const SAMPLE_CUSTOMER_NAMES = ['Aïssata M.', 'Fatoumata M.', 'Ramata O.', 'Awa S.', 'Mariam K.', 'Salimata T.', 'Adjara B.', 'Claire D.', 'Sophie L.', 'Emma R.', 'Camille B.', 'Marie T.'];
function pickSampleNames() { return [...SAMPLE_CUSTOMER_NAMES].sort(() => Math.random() - 0.5).slice(0, 3); }

// ---------- Transitions ----------
function chooseAttribute(key, value) {
  dialogue.chosen[key] = value;
  dialogue.proposal = null;
  // Photo de la variante choisie (couleur/teinte) si la vendeuse en a rattaché une.
  if (key === 'color' || key === 'shade') {
    const photos = variantPhotos(dialogue.product, value);
    if (photos.length) { addReply(`Voici ${esc(dialogue.product.name)} en ${esc(value)} 🌷`); photos.forEach(addImageReply); }
  }
}

// Photos rattachées à une couleur précise (media.variants[i] === value).
function variantPhotos(product, value) {
  const variants = (product.media && product.media.variants) || [];
  return product.media.photos.filter((photo, index) => variants[index] && NLU.normalize(variants[index]) === NLU.normalize(value));
}

function chooseCustomerName(name) {
  dialogue.customerName = name;
  if (typeof onCustomerNamed === 'function') onCustomerNamed(name);
}

function chooseDelivery(mode) {
  if (mode === 'delivery' && !deliveryAvailable()) {
    addReply(`Je n'ai pas encore les informations de livraison à domicile de la part de ${shopName()}, mais vous pouvez retirer votre commande en boutique.`);
    setChoices([{ id: 'pickup', label: 'Retrait en boutique' }, ...baseExtras()]);
    dialogue.pending = { type: 'delivery' };
    return;
  }
  dialogue.deliveryMode = mode;
  addReply(mode === 'delivery'
    ? `Nous livrons à ${esc(shopProfile.deliveryZone)} pour ${money(Number(shopProfile.deliveryFee))}. Comment souhaitez-vous payer votre commande ?`
    : 'Très bien. Comment souhaitez-vous payer votre commande ?');
  askNext();
}

function cartTotal() {
  const { product } = dialogue;
  const current = product.price * Math.max(1, dialogue.quantity || 1);
  return dialogue.cart.reduce((sum, item) => sum + item.price * item.quantity, 0) + current;
}

function choosePayment(paymentId) {
  const { product } = dialogue;
  dialogue.payment = paymentId;
  const deliveryFee = dialogue.deliveryMode === 'delivery' ? Number(shopProfile.deliveryFee) : 0;
  const quantity = Math.max(1, dialogue.quantity || 1);
  // Lignes de commande : panier + article courant. Le stock est décrémenté ligne par ligne, sans
  // jamais passer sous zéro ; si le stock ne suffit pas, la quantité est ramenée au disponible.
  const lines = [...dialogue.cart, { productId: product.id, name: product.name, price: product.price, category: product.category, chosen: { ...dialogue.chosen }, quantity }];
  const shortages = [];
  lines.forEach(line => {
    const item = products.find(p => p.id === line.productId);
    if (!item) return;
    const available = Number(item.stock);
    if (available < line.quantity) { shortages.push(`${item.name} (il en reste ${available})`); line.quantity = Math.max(0, available); }
    item.stock = Math.max(0, available - line.quantity);
  });
  save(productKey, products);
  const kept = lines.filter(line => line.quantity > 0);
  const amount = kept.reduce((sum, line) => sum + line.price * line.quantity, 0) + deliveryFee;
  const labels = kept.map(line => lineLabel(products.find(p => p.id === line.productId) || product, line.chosen, line.quantity));
  const totalLabel = dialogue.deliveryMode === 'delivery' ? `Total : ${money(amount)} (livraison incluse)` : `Total : ${money(amount)} (retrait en boutique)`;
  if (shortages.length) addReply(`Petite précision : le stock est limité pour ${shortages.map(esc).join(', ')}. J'ai ajusté la quantité 🌷`);
  addReply(`Merci 🌷 Votre commande est presque prête.<br><br><strong>${labels.map(esc).join('<br>')}</strong><br>${totalLabel}<br>Paiement : ${PAYMENT_LABELS[paymentId]}<br><br>Je transmets votre commande à ${shopName()} pour confirmation.`);
  const customerName = dialogue.customerName || 'Nouvelle cliente';
  const orderId = `o${Date.now()}`;
  orders.unshift({ id: orderId, customer: customerName, customerId: getOrCreateCustomerId(customerName), product: labels.join(' + '), amount, status: 'à confirmer', category: kept.length ? kept[0].category : product.category, date: new Date().toISOString(), lines: kept.map(line => ({ productId: line.productId, quantity: line.quantity })) });
  save(orderKey, orders);
  renderWorkspace();
  showToast('Nouvelle commande enregistrée.');
  closeDialogue();
  if (typeof onOrderPlaced === 'function') onOrderPlaced(orderId);
}

function closeDialogue() {
  const { product, schema } = dialogue;
  suggestions.innerHTML = '';
  addReply(`Merci d'avoir choisi ${shopName()} pour vos achats 🌷 Nous espérons vous revoir très bientôt !`);
  if (product.rangeName) {
    const others = products.filter(item => item.category === product.category && item.rangeName === product.rangeName && item.id !== product.id);
    if (others.length) addReply(`Au fait, ${esc(product.name)} fait partie de notre ${esc(product.rangeName)} — nous avons aussi ${others.map(item => esc(item.name)).join(', ')} dans la même ${schema.rangeWord}, si cela vous intéresse.`);
  }
  dialogue.pending = { type: 'closed' };
  setChoices([{ id: 'human', label: 'Parler à la boutique' }]);
}

function handleDoubt() {
  if (!dialogue.reassuranceUsed) {
    dialogue.reassuranceUsed = true;
    addReply(REASSURANCE_TEXT());
    return;
  }
  addReply(`Bien sûr, je préviens ${shopName()} pour qu'elle vous rassure directement 🌷`);
  escalateToShop('Doute sur la qualité — demande à être rassurée', dialogue.product, { silent: true });
}

// ---------- Boutons de choix rapides ----------
// Renvoie true si le choix a été traité par le moteur.
function handleDialogueChoice(choice) {
  const { product, schema } = dialogue;
  if (!schema) return false;
  if (choice.startsWith('customer-name:')) { chooseCustomerName(choice.slice(14)); askNext(); return true; }
  if (choice === 'doubt') { handleDoubt(); return true; }
  if (choice === 'human') { escalateToShop('Souhaite parler directement à la boutique', product); return true; }
  if (choice === 'material' && product.material) { addReply(`Il est en ${esc(product.material)}.`); askNext(); return true; }
  if (choice === 'add-more') { offerOtherProducts(); return true; }
  if (choice === 'no-more') { addReply('Très bien 🌷'); askNext(); return true; }
  if (choice.startsWith('product:')) { const next = products.find(item => item.id === choice.slice(8)); if (next) { switchProduct(next); return true; } }
  for (const attr of schema.attributes) {
    if (attr.missing && choice === attr.missing.id) { addReply(attr.missing.reply(product)); askNext(); return true; }
    if (choice.startsWith(`${attr.key}:`)) { chooseAttribute(attr.key, choice.slice(attr.key.length + 1)); askNext(); return true; }
  }
  if (choice === 'delivery' || choice === 'pickup') { chooseDelivery(choice); return true; }
  if (PAYMENT_LABELS[choice]) { choosePayment(choice); return true; }
  return false;
}

// ---------- Texte libre ----------
// Intentions « faibles » : elles ne répondent que si elles sont seules dans le message
// (un « bonjour » ou un « c'est quoi » ne doivent pas noyer une vraie question).
const WEAK_INTENTS = new Set(['greeting', 'info', 'thanks', 'affirmative', 'negative']);
// Les intentions qui répondent elles-mêmes à une question en cours (couleur/taille) sont
// traitées avant les autres pour garder le fil de la conversation.
const MAX_ANSWERS_PER_MESSAGE = 3;

// Reprise de la commande : après une réponse « à côté » (prix, horaires, livraison, conseil de
// l'assistant…) posée en pleine commande, Ọjà repose la question en cours pour que la cliente
// ne reste pas bloquée. Pas après les intentions qui font elles-mêmes avancer la commande.
const RESUME_AFTER = new Set(['price', 'stock', 'material', 'photos', 'worn', 'video', 'hours', 'delivery', 'payment', 'installment']);
function resumeFlow() {
  if (!dialogue.schema || !dialogue.pending || dialogue.pending.type === 'closed' || dialogue.proposal) return;
  askNext();
}

function handleFreeText(message) {
  const product = dialogue.product;
  const analysis = NLU.analyze(message);
  let strong = analysis.intents.filter(i => !WEAK_INTENTS.has(i.id));
  const weak = analysis.intents.filter(i => WEAK_INTENTS.has(i.id));

  // 1. Le message répond-il à la question en cours ?
  if (dialogue.schema && answerPendingQuestion(message, analysis, strong)) return;

  // 2. Un autre article du catalogue est nommé (« je veux aussi le sac Lune ») : on l'ajoute.
  const mentioned = dialogue.schema ? findMentionedProduct(analysis.normalized) : null;
  if (mentioned && (strong.some(i => ['order', 'price', 'stock', 'info'].includes(i.id)) || weak.some(i => i.id === 'info') || /aussi|ajouter|egalement|plus/.test(analysis.normalized))) {
    if (analysis.entities.quantity) dialogue.quantity = analysis.entities.quantity;
    switchProduct(mentioned);
    return;
  }

  // 2b. Entités sans mot-clé explicite : « ça existe en noir ? », « vous l'avez en 38 ? »
  //     Pas pour une question de conseil : « peau noire » n'est pas une couleur, « ça taille petit » pas une taille S.
  const advice = strong.some(i => i.id === 'advice');
  if (product && !advice && !strong.some(i => i.id === 'color') && analysis.entities.colors.length) strong.push({ id: 'color', score: 1, priority: 2, hits: analysis.entities.colors });
  if (product && !advice && !strong.some(i => ['size', 'price', 'delivery', 'installment'].includes(i.id)) && analysis.entities.sizes.length && findAttrByEntity('sizes')) strong.push({ id: 'size', score: 1, priority: 3, hits: analysis.entities.sizes });
  // 2c. Commande avec précisions : « Taille M, je veux la commander » -> M est retenue tout de suite,
  //     au lieu de proposer M puis de redemander la taille.
  let chosenNow = [];
  if (product && dialogue.schema && strong.some(i => i.id === 'order')) {
    pendingAttributes().forEach(attr => {
      const value = NLU.matchValue(message, product[attr.key].values);
      if (value) { chooseAttribute(attr.key, value); chosenNow.push(attr.key === 'size' ? `taille ${value}` : value); }
    });
    if (chosenNow.length) strong = strong.filter(i => !['color', 'size'].includes(i.id));
  }
  analysis.chosenNow = chosenNow;
  // « Payer en 2 fois » est une question d'échelonnement, pas de moyen de paiement.
  if (strong.some(i => i.id === 'installment')) { const idx = strong.findIndex(i => i.id === 'payment'); if (idx >= 0) strong.splice(idx, 1); }
  strong.sort((a, b) => b.score - a.score || a.priority - b.priority);

  // 3. Intentions fortes, au plus MAX_ANSWERS_PER_MESSAGE réponses ; un `false` impose le transfert
  //    à la boutique. Une question de conseil (`advice`) est confiée à l'assistant local après les
  //    réponses à règles : « c'est combien et ça se lave en machine ? » -> prix, puis conseil.
  let answered = 0;
  let mustEscalate = false;
  let needsAssistant = false;
  let advancedFlow = false;
  for (const intent of strong) {
    if (answered >= MAX_ANSWERS_PER_MESSAGE) break;
    if (intent.id === 'advice') { needsAssistant = true; continue; }
    const handler = INTENT_HANDLERS[intent.id];
    if (!handler) continue;
    const result = handler(product, analysis, intent);
    if (result === true) { answered += 1; if (!RESUME_AFTER.has(intent.id)) advancedFlow = true; }
    else if (result === false) { mustEscalate = true; break; }
  }
  if (mustEscalate) { escalateToShop(message, product); return; }
  if (needsAssistant) { fallbackOrEscalate(message, product, { advice: true, resume: !advancedFlow }); return; }
  if (answered) { if (!advancedFlow) resumeFlow(); return; }

  // 4. Intentions faibles seules (salutation, remerciement, demande d'infos générique).
  for (const intent of weak) {
    const handler = INTENT_HANDLERS[intent.id];
    if (handler && handler(product, analysis, intent) === true) return;
  }

  // 5. Filet de sécurité : l'assistant local s'il est activé (et sûr de lui), sinon transfert.
  fallbackOrEscalate(message, product);
}

// Dernier recours avant le transfert : demander au modèle local (assistant.js), qui ne peut
// répondre que depuis les données de la boutique. Pas de modèle, pas de réponse sûre, ou service
// injoignable -> transfert, exactement comme avant.
function fallbackOrEscalate(message, product, { advice = false, resume = true } = {}) {
  if (typeof assistantEnabled !== 'function' || !assistantEnabled()) { escalateToShop(message, product); return; }
  const history = activeThread ? activeThread.messages.slice(0, -1) : [];
  const typing = document.createElement('div');
  typing.className = 'assistant-label typing';
  typing.textContent = 'Ọjà réfléchit…';
  chat.appendChild(typing);
  askAssistant(product, history, message, { advice }).then(result => {
    typing.remove();
    if (result.answer) { addReply(`${result.answer} <small class="assistant-tag">assistant</small>`); if (resume) resumeFlow(); return; }
    // Pour la vendeuse seulement : pourquoi l'assistant n'a pas répondu (jamais envoyé à la cliente).
    const note = typeof assistantFailureNote === 'function' ? assistantFailureNote(result) : null;
    if (note && typeof chat !== 'undefined' && chat) { const label = document.createElement('div'); label.className = 'assistant-label assistant-diag'; label.textContent = note; chat.appendChild(label); }
    escalateToShop(message, product);
  });
}

function findAttrByEntity(entity) {
  const { product, schema } = dialogue;
  if (!schema) return null;
  return schema.attributes.find(attr => attr.entity === entity && attr.isActive(product) && hasChoices(product[attr.key])) || null;
}

// Un message interrogatif (« vous livrez en combien de temps ? ») n'est pas une réponse à la
// question en cours, même s'il contient les mêmes mots qu'une réponse : il est traité comme
// une question d'information, et la question d'Ọjà reste en attente.
function looksLikeQuestion(message, normalized) {
  if (/\?/.test(message)) return true;
  return /(^|\s)(est ce que|combien|quand|comment|pourquoi|quoi|quel|quelle|quels|quelles|ou est|delai)(\s|$)/.test(normalized);
}

function answerPendingQuestion(message, analysis, strongIntents) {
  const { product, pending } = dialogue;
  if (!pending) return false;
  if (looksLikeQuestion(message, analysis.normalized)) return false;
  if (pending.type === 'attribute') {
    const matched = [];
    pending.keys.forEach(key => {
      const value = NLU.matchValue(message, product[key].values);
      if (value) { chooseAttribute(key, value); matched.push(value); }
    });
    if (matched.length) {
      addReply(`Très bien, ${listValues(matched)} 🌷`);
      askNext();
      return true;
    }
    // « oui » après une proposition (« Souhaitez-vous qu'on continue avec cette couleur ? »)
    if (dialogue.proposal && analysis.intents.some(i => i.id === 'affirmative') && !strongIntents.length) {
      chooseAttribute(dialogue.proposal.key, dialogue.proposal.value);
      addReply('Parfait 🌷');
      askNext();
      return true;
    }
    return false;
  }
  if (pending.type === 'name') {
    const name = NLU.extractName(message, { expectingName: true, intents: analysis.intents.filter(i => i.id !== 'greeting') });
    if (name) {
      chooseCustomerName(name);
      addReply(`Merci ${esc(name)} 🌷`);
      askNext();
      return true;
    }
    return false;
  }
  if (pending.type === 'delivery') {
    const mode = analysis.entities.deliveryMode;
    if (mode) { chooseDelivery(mode); return true; }
    return false;
  }
  if (pending.type === 'payment') {
    const payment = analysis.entities.payment;
    if (payment) { choosePayment(payment); return true; }
    return false;
  }
  return false;
}

// ---------- Réponses par intention ----------
// Contrat : true = a répondu ; false = doit transférer à la boutique ; null = ne s'applique pas.
const INTENT_HANDLERS = {
  human() { return false; },
  // Paiement échelonné : uniquement si la boutique a configuré ses règles dans son profil.
  installment() {
    const min = Number(shopProfile.installmentMin);
    const percent = Number(shopProfile.installmentPercent);
    if (!shopProfile.installmentMin || !shopProfile.installmentPercent || Number.isNaN(min) || Number.isNaN(percent)) return false;
    const total = dialogue.schema ? cartTotal() : 0;
    if (total && total < min) { addReply(`Le paiement en plusieurs fois est possible à partir de ${money(min)} d'achat. Votre panier est à ${money(total)} 🌷`); return true; }
    addReply(`Oui 🌷 À partir de ${money(min)} d'achat, vous pouvez payer en plusieurs fois avec <strong>${percent} % d'avance</strong>${total ? ` (soit ${money(Math.round(total * percent / 100))} pour votre panier)` : ''}. Le reste se règle à la livraison ou au retrait.`);
    return true;
  },

  color(product, analysis) {
    if (!product) return null;
    const attr = findAttrByEntity('colors') || (dialogue.schema ? dialogue.schema.attributes.find(a => a.key === 'color' || a.key === 'shade') : null);
    const known = attr && product[attr.key] && product[attr.key].values ? product[attr.key].values.filter(Boolean) : [];
    const asked = analysis.entities.colors.find(color => known.some(value => NLU.normalize(value).includes(color)));
    if (asked && known.length) {
      const value = known.find(v => NLU.normalize(v).includes(asked));
      const alreadyChosen = dialogue.chosen[attr.key] === value;
      if (alreadyChosen) { addReply(`Oui, ${esc(value)} est bien disponible pour cet article 🌷`); return true; }
      dialogue.proposal = { key: attr.key, value };
      addReply(`Oui, ${esc(asked)} est disponible pour cet article 🌷 Souhaitez-vous qu'on continue avec cette ${attr.label} ?`);
      setChoices([{ id: `${attr.key}:${value}`, label: `Oui, ${value}` }, ...known.filter(v => v !== value).map(v => ({ id: `${attr.key}:${v}`, label: v })), ...baseExtras()]);
      return true;
    }
    if (known.length) {
      addReply(`Pour cet article, nous avons actuellement : <strong>${listValues(known)}</strong>. Est-ce que l'une de ces ${attr.label}s vous convient ?`);
      if (product[attr.key].mode === 'plusieurs') { setChoices([...known.map(v => ({ id: `${attr.key}:${v}`, label: v })), ...baseExtras()]); dialogue.pending = { type: 'attribute', keys: [attr.key] }; }
      return true;
    }
    addReply(`Cet article est disponible dans sa couleur actuelle. Je vérifie avec ${shopName()} s'il existe d'autres coloris et je reviens vers vous 🌷`);
    return false;
  },

  size(product, analysis) {
    const attr = findAttrByEntity('sizes');
    if (!attr) return null;
    const values = product[attr.key].values.filter(Boolean);
    const asked = analysis.entities.sizes.find(size => values.some(v => String(v).toUpperCase() === size));
    if (asked) {
      const value = values.find(v => String(v).toUpperCase() === asked);
      dialogue.proposal = { key: attr.key, value };
      addReply(`Oui, ${esc(value)} est disponible 🌷 On continue avec cette ${attr.label} ?`);
      setChoices([{ id: `${attr.key}:${value}`, label: `Oui, ${value}` }, ...values.filter(v => v !== value).map(v => ({ id: `${attr.key}:${v}`, label: v })), ...baseExtras()]);
      return true;
    }
    if (analysis.entities.sizes.length) {
      addReply(`Cet article n'existe pas en ${listValues(analysis.entities.sizes)}, mais nous l'avons en ${listValues(values)} 🌷`);
    } else {
      addReply(attr.question(product));
    }
    if (product[attr.key].mode === 'plusieurs') { setChoices([...values.map(v => ({ id: `${attr.key}:${v}`, label: v })), ...baseExtras()]); dialogue.pending = { type: 'attribute', keys: [attr.key] }; }
    return true;
  },

  price(product, analysis, intent) {
    if (!product) return null;
    const negotiating = intent.hits.some(h => ['moins cher', 'reduction', 'promo', 'promotion', 'negocier', 'dernier prix', 'baisser'].includes(h));
    let text = `${esc(product.name)} est à <strong>${money(product.price)}</strong>`;
    if (deliveryAvailable()) text += ` (+ ${money(Number(shopProfile.deliveryFee))} pour la livraison à ${esc(shopProfile.deliveryZone)}, ou retrait gratuit en boutique)`;
    addReply(`${text} 🌷`);
    if (negotiating) { addReply(`Pour toute question sur une remise, c'est ${shopName()} qui décide — je lui transmets votre demande 🌷`); return false; }
    return true;
  },

  stock(product) {
    if (!product) return null;
    if (Number(product.stock) > 0) { addReply(`Oui, ${esc(product.name)} est disponible 🌷 Il en reste ${Number(product.stock)} en stock.`); return true; }
    addReply(`${esc(product.name)} est en rupture de stock pour le moment. Je préviens ${shopName()} pour savoir quand il sera de retour 🌷`);
    return false;
  },

  photos(product) {
    if (!product) return null;
    const chosenColor = dialogue.chosen.color || dialogue.chosen.shade;
    const matching = chosenColor ? variantPhotos(product, chosenColor) : [];
    if (matching.length) { addReply(`Voici ${esc(product.name)} en ${esc(chosenColor)} 🌷`); matching.forEach(addImageReply); return true; }
    const { productPhotos } = splitProductPhotos(product.media);
    if (productPhotos.length) {
      addReply(`Je n'ai pas encore de photos d'autres clientes, mais voici ${productPhotos.length > 1 ? 'd\'autres photos' : 'une autre photo'} de l'article 🌷`);
      productPhotos.forEach(addImageReply);
    } else {
      addReply(`Je n'ai pas encore de photos d'autres clientes à vous montrer, et je n'ai pas non plus d'autre photo de cet article pour l'instant 🌷 Je peux demander à ${shopName()} si elle en a une à vous envoyer.`);
    }
    return true;
  },

  worn(product) {
    if (!product) return null;
    const { wornPhotos } = splitProductPhotos(product.media);
    if (wornPhotos.length) { addReply('Bien sûr 🌷 Voici l\'article porté :'); wornPhotos.forEach(addImageReply); return true; }
    addReply(`Je n'ai pas encore de photo de cet article porté, mais je transmets votre demande à ${shopName()} 🌷`);
    return false;
  },

  video(product) {
    if (!product) return null;
    if (product.media.video) { addReply('Voici une courte vidéo de l\'article 🌷'); addVideoReply(product.media.video); return true; }
    addReply(`Je n'ai pas encore de vidéo pour cet article, mais je transmets votre demande à ${shopName()} 🌷`);
    return false;
  },

  material(product) {
    if (!product) return null;
    if (product.material) { addReply(`Bonne question 🌷 Cet article est en <strong>${esc(product.material)}</strong>. Chez ${shopName()}, la qualité est une priorité — vous pouvez commander en toute confiance.`); return true; }
    if (product.category === 'Cosmétiques' && product.boxContent) { addReply(`Le coffret comprend : <strong>${esc(product.boxContent)}</strong>. Pour la composition détaillée, je transmets à ${shopName()} 🌷`); return false; }
    addReply(`Chez ${shopName()}, la qualité de nos articles est une vraie priorité 🌷 Je transmets votre question à ${shopName()} pour plus de détails sur cet article précis.`);
    return false;
  },

  hours() {
    if (shopProfile.hours) { addReply(`Nos horaires : <strong>${esc(shopProfile.hours)}</strong> 🌷`); return true; }
    addReply(`Je n'ai pas encore les horaires précis de la boutique de la part de ${shopName()}, je transmets votre question 🌷`);
    return false;
  },

  delivery() {
    const hasZoneFee = deliveryAvailable();
    const hasDelay = Boolean(shopProfile.deliveryDelay);
    if (hasZoneFee && hasDelay) { addReply(`Nous livrons à <strong>${esc(shopProfile.deliveryZone)}</strong> pour ${money(Number(shopProfile.deliveryFee))}, sous <strong>${esc(shopProfile.deliveryDelay)}</strong> 🌷`); return true; }
    if (hasZoneFee) { addReply(`Nous livrons à <strong>${esc(shopProfile.deliveryZone)}</strong> pour ${money(Number(shopProfile.deliveryFee))}. Je vérifie le délai exact avec ${shopName()} et je reviens vers vous 🌷`); return true; }
    addReply(`Je n'ai pas encore toutes les informations de livraison de la part de ${shopName()}, je transmets votre question 🌷`);
    return false;
  },

  pickup() {
    addReply(`Le retrait en boutique est possible 🌷 Je demande à ${shopName()} de vous communiquer l'adresse exacte.`);
    return false;
  },

  payment() {
    addReply('Vous pouvez payer par <strong>Orange Money, Moov Money, Wave</strong>, ou à la livraison 🌷');
    return true;
  },

  order(product, analysis) {
    if (!product || !dialogue.schema) return null;
    if (analysis.entities.quantity) dialogue.quantity = analysis.entities.quantity;
    if (dialogue.pending && dialogue.pending.type === 'closed') { dialogue = freshDialogue(product); presetUniqueValues(); }
    const notedList = analysis.chosenNow && analysis.chosenNow.length ? listValues(analysis.chosenNow) : '';
    const noted = notedList ? ` ${notedList.charAt(0).toUpperCase()}${notedList.slice(1)}, c'est noté.` : '';
    addReply(analysis.entities.quantity > 1 ? `Avec plaisir 🌷 ${analysis.entities.quantity} × ${esc(product.name)}${noted ? ` —${noted}` : ", c'est noté."}` : `Avec plaisir 🌷${noted}`);
    askNext();
    return true;
  },

  thanks() { addReply('Je vous en prie 🌷'); return true; },

  greeting(product) {
    if (!product || !dialogue.schema) { addReply(`Bonjour et bienvenue chez ${shopName()} 🌷 Comment puis-je vous aider ?`); return true; }
    addReply(`Bonjour et bienvenue chez ${shopName()} 🌷 ${introSentences(product)}`);
    return true;
  },

  info(product) {
    if (!product || !dialogue.schema) return null;
    addReply(`Avec plaisir 🌷 ${introSentences(product)}`);
    return true;
  },

  doubt() { handleDoubt(); return true; },

  negative() {
    addReply(`Pas de souci 🌷 Dites-moi ce que vous préférez, ou je peux prévenir ${shopName()} pour qu'elle vous réponde directement.`);
    return true;
  },

  affirmative() {
    if (dialogue.proposal) { chooseAttribute(dialogue.proposal.key, dialogue.proposal.value); addReply('Parfait 🌷'); askNext(); return true; }
    if (dialogue.schema && dialogue.pending && dialogue.pending.type !== 'closed') { askNext(); return true; }
    return null;
  }
};
