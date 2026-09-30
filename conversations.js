// =====================================================================================
// conversations.js — Journal des conversations et reprise en main par la vendeuse
//
// Chaque échange avec une cliente est un « fil » (thread) : cliente, produit, messages,
// état, commande liée, et l'état interne du moteur de dialogue pour reprendre là où on
// en était. Les fils sont persistés dans localStorage (clé oja-conversations).
//
// Le téléphone du simulateur affiche toujours un fil : celui qu'on vient d'ouvrir depuis la
// vue Conversations ou une alerte, ou un fil neuf (« Simuler une cliente », ou l'exemple de
// démarrage). Le fil de démarrage n'est enregistré qu'à la première interaction.
//
// Deux modes de saisie dans le téléphone :
//   - customer : Josie joue la cliente (simulateur) — Ọjà répond.
//   - seller   : Josie répond elle-même en tant que boutique — Ọjà se met en pause sur ce
//                fil (relais humain du cahier des charges), jusqu'à « Rendre la main à Ọjà ».
//
// Dépendances (app.js, à l'exécution) : read, save, esc, chat, suggestions, products,
// shopProfile, showToast, handleChoice, renderOrders, deliveryAvailable.
// Dépendances (dialogue.js) : dialogue, freshDialogue, presetUniqueValues, askNext, setChoices.
// =====================================================================================

const conversationKey = 'oja-conversations';
let threads = [];
let activeThread = null;
let composerMode = 'customer'; // 'customer' | 'seller'

function initConversations() {
  threads = read(conversationKey, []);
}

function saveThreads() {
  // Les photos/vidéos sont des dataURL : on tente, et si le quota est dépassé on garde les
  // fils en mémoire sans bloquer l'app (prototype local).
  try { save(conversationKey, threads); } catch (error) { console.warn('Journal des conversations non persisté :', error); }
}

function nowIso() { return new Date().toISOString(); }
function clock(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function threadLabel(thread) { return thread.customerName || 'Nouvelle cliente'; }

// ---------- Création / ouverture ----------
function newThread(product, { persist = false, seed = [] } = {}) {
  const thread = {
    id: `t${Date.now()}${Math.floor(Math.random() * 1000)}`,
    customerName: null,
    productId: product ? product.id : null,
    productName: product ? product.name : 'Conversation',
    category: product ? product.category : null,
    messages: [],
    status: 'oja',        // 'oja' | 'seller' | 'closed'
    needsSeller: false,
    unread: 0,
    orderId: null,
    lastChoices: [],
    dialogue: null,
    persisted: persist,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  activeThread = thread;
  if (persist) { threads.unshift(thread); saveThreads(); }
  renderChatFromThread();
  seed.forEach(message => pushMessage(message.from, message.kind, message.body));
  return thread;
}

// Le fil n'est enregistré qu'à sa première interaction réelle, pour ne pas polluer le
// journal avec l'exemple de démarrage affiché à chaque chargement.
function ensurePersisted() {
  if (!activeThread || activeThread.persisted) return;
  activeThread.persisted = true;
  threads.unshift(activeThread);
}

function touchThread() {
  if (!activeThread) return;
  activeThread.updatedAt = nowIso();
  activeThread.dialogue = snapshotDialogue();
  if (activeThread.persisted) saveThreads();
  renderConversationsView();
  if (typeof renderFirstStep === 'function') renderFirstStep();
}

function openThread(id) {
  const thread = threads.find(item => item.id === id);
  if (!thread) return false;
  activeThread = thread;
  const product = products.find(item => item.id === thread.productId) || null;
  if (product) { activeProduct = product; activeCategory = product.category; }
  thread.unread = 0;
  restoreDialogue(thread, product);
  renderChatFromThread();
  if (thread.status === 'oja' && thread.lastChoices.length) setChoices(thread.lastChoices, { record: false });
  else suggestions.innerHTML = '';
  setComposerMode('customer');
  renderPhoneState();
  renderConversationsView();
  renderWorkspace();
  // Sur mobile, la liste est au-dessus du téléphone : on amène le fil ouvert à l'écran.
  if (window.innerWidth <= 620) document.querySelector('.phone-zone').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

// ---------- Messages ----------
// from : 'customer' | 'oja' | 'seller' ; kind : 'text' | 'image' | 'video'
function pushMessage(from, kind, body) {
  const message = { from, kind, body, at: nowIso() };
  if (activeThread) {
    activeThread.messages.push(message);
    if (from !== 'seller' && activeThread.messages.length > 3) ensurePersisted();
  }
  renderMessage(message, activeThread ? activeThread.messages : [message]);
  if (activeThread) touchThread();
  return message;
}

function renderMessage(message, all) {
  const index = all.indexOf(message);
  const previous = index > 0 ? all[index - 1] : null;
  // Étiquette « X répond » au changement d'auteur côté boutique.
  if (message.from === 'oja' && (!previous || previous.from !== 'oja')) {
    const label = document.createElement('div'); label.className = 'assistant-label'; label.textContent = 'Ọjà répond pour vous'; chat.appendChild(label);
  }
  if (message.from === 'seller' && (!previous || previous.from !== 'seller')) {
    const label = document.createElement('div'); label.className = 'assistant-label seller-label'; label.textContent = `${shopProfile.sellerName || 'La boutique'} répond`; chat.appendChild(label);
  }
  const bubble = document.createElement('div');
  const side = message.from === 'customer' ? 'incoming' : 'outgoing';
  bubble.className = `bubble ${side}${message.kind !== 'text' ? ' bubble-image' : ''}${message.from === 'seller' ? ' seller' : ''}`;
  const time = `<time>${clock(message.at)}${side === 'outgoing' ? ' ✓✓' : ''}</time>`;
  if (message.kind === 'image') bubble.innerHTML = `<img class="zoomable" src="${message.body}" alt="${side === 'incoming' ? 'Photo envoyée par la cliente' : 'Photo envoyée par la boutique'}">${time}`;
  else if (message.kind === 'video') bubble.innerHTML = `<video src="${message.body}" controls></video>${time}`;
  else bubble.innerHTML = `${message.body}${time}`;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function renderChatFromThread() {
  chat.innerHTML = '<div class="date-pill">Aujourd\'hui</div>';
  if (!activeThread) return;
  activeThread.messages.forEach(message => renderMessage(message, activeThread.messages));
}

// ---------- État du moteur de dialogue, sérialisé dans le fil ----------
function snapshotDialogue() {
  if (!dialogue || !dialogue.schema) return null;
  const { chosen, quantity, customerName, deliveryMode, payment, reassuranceUsed, proposal, pending, cart, cartSummarized } = dialogue;
  return { chosen: { ...chosen }, quantity, customerName, deliveryMode, payment, reassuranceUsed, proposal, pending, cart: cart.map(item => ({ ...item })), cartSummarized };
}

function restoreDialogue(thread, product) {
  dialogue = freshDialogue(product);
  if (!dialogue.schema) return;
  presetUniqueValues();
  if (thread.dialogue) Object.assign(dialogue, thread.dialogue, { chosen: { ...dialogue.chosen, ...thread.dialogue.chosen }, cart: (thread.dialogue.cart || []).map(item => ({ ...item })) });
  if (thread.customerName && !dialogue.customerName) dialogue.customerName = thread.customerName;
}

// Appelé par dialogue.js quand la cliente donne son nom.
function onCustomerNamed(name) {
  if (!activeThread) return;
  activeThread.customerName = name;
  ensurePersisted();
  touchThread();
  renderPhoneState();
}

// Appelé par dialogue.js quand une commande est enregistrée.
function onOrderPlaced(orderId) {
  if (!activeThread) return;
  activeThread.orderId = orderId;
  activeThread.status = 'closed';
  ensurePersisted();
  touchThread();
  renderPhoneState();
}

// Appelé par app.js à chaque transfert vers la vendeuse.
function onEscalated() {
  if (!activeThread) return;
  activeThread.needsSeller = true;
  ensurePersisted();
  touchThread();
  renderPhoneState();
}

// ---------- Mode de saisie et reprise en main ----------
function setComposerMode(mode) {
  composerMode = mode;
  document.querySelectorAll('[data-composer-mode]').forEach(button => button.classList.toggle('active', button.dataset.composerMode === mode));
  const input = document.querySelector('#composer-input');
  input.placeholder = mode === 'seller' ? `Répondre en tant que ${shopProfile.shopName || 'la boutique'}` : 'Écrivez un message';
  document.querySelector('.phone').classList.toggle('seller-mode', mode === 'seller');
}

// Josie envoie un message en tant que boutique : Ọjà se met en pause sur ce fil.
function sellerReply(text) {
  if (!activeThread) return;
  ensurePersisted();
  activeThread.status = 'seller';
  activeThread.needsSeller = false;
  escalations = escalations.filter(item => item.threadId !== activeThread.id);
  save(escalationKey, escalations);
  pushMessage('seller', 'text', esc(text));
  suggestions.innerHTML = '';
  renderPhoneState();
  renderWorkspace();
}

// Josie rend la main : Ọjà reprend le fil là où il en était (repropose sa question en cours).
function resumeOja() {
  if (!activeThread || activeThread.status !== 'seller') return;
  activeThread.status = 'oja';
  pushMessage('oja', 'text', 'Je reprends la conversation 🌷 Où en étions-nous ?');
  if (dialogue.schema && dialogue.pending && dialogue.pending.type !== 'closed') askNext();
  else if (activeThread.lastChoices.length) setChoices(activeThread.lastChoices);
  touchThread();
  renderPhoneState();
  showToast('Ọjà a repris cette conversation.');
}

function renderPhoneState() {
  const label = document.querySelector('#phone-thread-label');
  const paused = document.querySelector('#oja-paused');
  if (!activeThread) { label.textContent = ''; paused.classList.add('hidden'); return; }
  const who = threadLabel(activeThread);
  const what = activeThread.productName ? ` · ${activeThread.productName}` : '';
  label.textContent = `${who}${what}`;
  paused.classList.toggle('hidden', activeThread.status !== 'seller');
}

// ---------- Vue Conversations ----------
// Les corps de message sont déjà du HTML sûr (échappé à l'enregistrement) : l'aperçu retire
// seulement les balises, sans ré-échapper.
function threadState(thread) {
  if (thread.status === 'seller') return { text: 'Vous répondez', cls: 'seller' };
  if (thread.needsSeller) return { text: 'À vous de répondre', cls: 'pending' };
  if (thread.status === 'closed') return { text: 'Commande prise', cls: 'ready' };
  return { text: 'Ọjà répond', cls: 'oja' };
}

function lastMessagePreview(thread) {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return 'Aucun message';
  if (last.kind === 'image') return '📷 Photo';
  if (last.kind === 'video') return '▶ Vidéo';
  const text = last.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function renderConversationsView() {
  const list = document.querySelector('#conversations-list');
  const counter = document.querySelector('#conversation-count');
  const toAnswer = threads.filter(thread => thread.needsSeller || thread.unread > 0).length;
  counter.textContent = toAnswer;
  counter.classList.toggle('hidden', toAnswer === 0);
  const sorted = [...threads].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (!sorted.length) {
    list.innerHTML = `<div class="conversations-empty">Aucune conversation pour l'instant. Cliquez sur « Simuler une cliente » depuis un produit, ou écrivez dans le téléphone.</div>`;
    return;
  }
  list.innerHTML = sorted.map(thread => {
    const state = threadState(thread);
    const active = activeThread && activeThread.id === thread.id;
    return `<button class="thread-card${active ? ' active' : ''}" data-thread-id="${thread.id}">
      <div class="customer ${thread.needsSeller ? 'yellow' : 'pink'}">${initials(threadLabel(thread))}</div>
      <div class="thread-copy"><strong>${esc(threadLabel(thread))}</strong><small>${esc(thread.productName || '')}</small><p>${lastMessagePreview(thread)}</p></div>
      <div class="thread-meta"><small>${timeAgo(thread.updatedAt)}</small><span class="status ${state.cls}">${state.text}</span>${thread.unread ? `<b class="unread">${thread.unread}</b>` : ''}</div>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-thread-id]').forEach(card => card.addEventListener('click', () => {
    openThread(card.dataset.threadId);
    showToast(`Conversation avec ${threadLabel(activeThread)} ouverte.`);
  }));
}
