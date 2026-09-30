// =====================================================================================
// server/engine.js — Le moteur de dialogue d'Ọjà, sans navigateur
//
// Charge nlu.js et dialogue.js (inchangés) dans un bac à sable Node avec des remplaçants
// minimaux pour ce que le navigateur fournissait : addReply -> on collecte les réponses,
// setChoices -> on collecte les boutons, escalateToShop -> on enregistre une alerte, etc.
//
// C'est la brique qui répondra sur WhatsApp : une session par cliente, le même moteur que
// le simulateur, les mêmes règles « ne jamais inventer ».
//
//   const { createSession } = require('./engine');
//   const session = createSession(state, { productId: 'robe' });
//   session.start();                 // accueil + première question
//   session.send('je prends la M');  // -> { replies: [...], choices: [...], escalations: [...] }
//   session.choose('color:Noir');    // clic sur un bouton
//   session.snapshot() / restore()   // pour persister l'état entre deux messages WhatsApp
// =====================================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['nlu.js', 'dialogue.js'].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'));

const DEFAULT_PROFILE = { shopName: 'Josie Style', sellerName: 'Josie K.', hours: '', deliveryDelay: '', deliveryZone: '', deliveryFee: '', installmentMin: '', installmentPercent: '' };

// state : { 'oja-products': [...], 'oja-profile': {...}, 'oja-orders': [...], 'oja-escalations': [...] }
// Les tableaux sont modifiés en place (commande enregistrée, stock décrémenté, alerte créée) :
// l'appelant les persiste ensuite avec `onSave`.
// onFallback(message, { advice }) : si fourni, remplace le repli « assistant local ou transfert »
// (dialogue.js → fallbackOrEscalate). Sert à l'évaluation du routage (eval_routing.js) et, plus
// tard, à brancher un assistant côté serveur pour WhatsApp.
function createSession(state, { productId = null, onSave = () => {}, onFallback = null } = {}) {
  const products = state['oja-products'] || [];
  const orders = state['oja-orders'] || (state['oja-orders'] = []);
  const escalations = state['oja-escalations'] || (state['oja-escalations'] = []);
  const shopProfile = { ...DEFAULT_PROFILE, ...(state['oja-profile'] || {}) };
  const settings = state['oja-settings'] || {};

  const out = { replies: [], choices: [], escalations: [], images: [], videos: [] };
  const lastReply = () => out.replies[out.replies.length - 1] || '';

  const sandbox = {
    console, setTimeout, clearTimeout, Number, String, Math, Date, JSON, Object, Array, Set, Map, RegExp, Error, Promise,
    products, orders, escalations, shopProfile, settings,
    activeProduct: products.find(p => p.id === productId) || products[0] || null,
    activeThread: null,
    productKey: 'oja-products', orderKey: 'oja-orders', escalationKey: 'oja-escalations',
    esc: (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])),
    money: value => `${Number(value).toLocaleString('fr-FR')} FCFA`,
    deliveryAvailable: () => Boolean(shopProfile.deliveryZone) && shopProfile.deliveryFee !== '' && !Number.isNaN(Number(shopProfile.deliveryFee)),
    splitProductPhotos: media => { const cut = media.photos.length - media.wornCount; return { productPhotos: media.photos.slice(0, cut), wornPhotos: media.photos.slice(cut) }; },
    getOrCreateCustomerId: name => { const existing = orders.find(o => o.customer === name); if (existing) return existing.customerId; const used = orders.map(o => Number(String(o.customerId || '').replace('c', ''))).filter(n => !isNaN(n)); return `c${used.length ? Math.max(...used) + 1 : 1}`; },
    save: (key, value) => onSave(key, value),
    renderOrders() {}, renderWorkspace() {}, showToast() {}, playNotification() {}, onEscalated() {},
    // Sorties du moteur
    addReply: text => out.replies.push(String(text)),
    addIncoming() {},
    addImageReply: url => out.images.push(url),
    addVideoReply: url => out.videos.push(url),
    setChoices: items => { out.choices = items.map(item => ({ id: item.id, label: item.label })); },
    suggestions: { set innerHTML(v) { if (v === '') out.choices = []; }, get innerHTML() { return ''; } },
    chat: { appendChild() {}, querySelector: () => ({ textContent: lastReply() }), scrollTop: 0, scrollHeight: 0 },
    document: { createElement: () => ({ className: '', textContent: '', remove() {} }) },
    assistantEnabled: () => false,
    escalateToShop(message, product, { silent = false } = {}) {
      const alreadyAnnounced = /transmets|préviens|je vérifie|je demande/i.test(lastReply());
      if (!silent && !alreadyAnnounced) out.replies.push(`Je transmets ça à ${sandbox.esc(shopProfile.shopName)}, elle vous répond très vite 🌷`);
      const escalation = { id: `e${Date.now()}`, productId: product ? product.id : null, productName: product ? product.name : 'Conversation', customerName: (sandbox.currentCustomerName && sandbox.currentCustomerName()) || 'Nouvelle cliente', message, date: new Date().toISOString() };
      escalations.unshift(escalation);
      out.escalations.push(escalation);
      onSave('oja-escalations', escalations);
    }
  };
  vm.createContext(sandbox);
  SOURCES.forEach((source, index) => vm.runInContext(source, sandbox, { filename: ['nlu.js', 'dialogue.js'][index] }));
  if (onFallback) sandbox.fallbackOrEscalate = (message, product, options = {}) => onFallback(message, options);

  function drain() {
    const result = { replies: out.replies.slice(), choices: out.choices.slice(), escalations: out.escalations.slice(), images: out.images.slice(), videos: out.videos.slice() };
    out.replies = []; out.escalations = []; out.images = []; out.videos = [];
    return result;
  }

  return {
    // Accueil + présentation du produit + première question.
    start() { vm.runInContext('startDialogue(activeProduct)', sandbox); return drain(); },
    // Message libre de la cliente.
    send(text) { vm.runInContext(`if (!dialogue.schema) resumeDialogueSilently(activeProduct); handleFreeText(${JSON.stringify(String(text))})`, sandbox); return drain(); },
    // Clic sur un bouton (id renvoyé dans `choices`).
    choose(id) { vm.runInContext(`if (!dialogue.schema) resumeDialogueSilently(activeProduct); handleDialogueChoice(${JSON.stringify(String(id))})`, sandbox); return drain(); },
    // État sérialisable, pour reprendre la conversation d'une cliente au message suivant.
    snapshot() { return vm.runInContext('(() => { const { chosen, quantity, customerName, deliveryMode, payment, reassuranceUsed, proposal, pending, cart, cartSummarized } = dialogue; return JSON.parse(JSON.stringify({ productId: dialogue.product ? dialogue.product.id : null, chosen, quantity, customerName, deliveryMode, payment, reassuranceUsed, proposal, pending, cart, cartSummarized })); })()', sandbox); },
    restore(snapshot) {
      if (!snapshot) return;
      sandbox.__snapshot = snapshot;
      vm.runInContext('(() => { const p = products.find(x => x.id === __snapshot.productId) || activeProduct; activeProduct = p; dialogue = freshDialogue(p); if (dialogue.schema) { presetUniqueValues(); Object.assign(dialogue, __snapshot, { chosen: { ...dialogue.chosen, ...__snapshot.chosen } }); delete dialogue.productId; } })()', sandbox);
    },
    choices: () => out.choices.slice(),
    pending: () => vm.runInContext('dialogue.pending', sandbox)
  };
}

module.exports = { createSession };
