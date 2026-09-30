const productKey = 'oja-products';
const orderKey = 'oja-orders';
const profileKey = 'oja-profile';
const escalationKey = 'oja-escalations';
const defaultProfile = { shopName:'Josie Style', sellerName:'Josie K.', contact:'', description:'', photo:'', logo:'', hours:'', deliveryDelay:'', deliveryZone:'', deliveryFee:'', installmentMin:'', installmentPercent:'' };
const chat = document.querySelector('#chat');
const toast = document.querySelector('#toast');
const suggestions = document.querySelector('#suggestions');
const themeToggle = document.querySelector('#theme-toggle');
const modal = document.querySelector('#product-modal');
const form = document.querySelector('#product-form');

const defaults = [
  {id:'robe',name:'Robe satin beige',price:18500,stock:5,category:'Vêtements',style:'dress',video:false,image:'',
    size:{sizeType:'Standard',mode:'plusieurs',values:['S','M','L']},
    color:{mode:'unique',values:['Beige']},
    material:'Satin',
    gender:'',
    setContent:'',
    rangeName:''},
  {id:'sac',name:'Sac à main Lune',price:17000,stock:4,category:'Accessoires',style:'bag',video:true,image:'',
    itemType:'Sac à main',
    color:{mode:'plusieurs',values:['Noir','Bordeaux']},
    material:'',
    dimension:{active:false,dimensionType:'Format',mode:'unique',values:['']},
    packContent:'',
    rangeName:''},
  {id:'glow',name:'Coffret Glow',price:12500,stock:5,category:'Cosmétiques',style:'care',video:false,image:'',
    productType:'Coffret soin visage',
    shade:{active:false,mode:'unique',values:['']},
    volume:{active:false,mode:'unique',values:['']},
    length:{active:false,mode:'unique',values:['']},
    texture:{active:false,mode:'unique',values:['']},
    expiryDate:'',
    boxContent:'Nettoyant, crème, sérum',
    rangeName:''}
];
const defaultOrders = [
  {id:'o1',customer:'Aïssata M.',customerId:'c1',product:'Robe satin beige · Taille M',amount:18500,status:'à confirmer',category:'Vêtements',date:new Date(Date.now() - 2*24*60*60*1000).toISOString()},
  {id:'o2',customer:'Fatoumata M.',customerId:'c2',product:'Sac à main Lune · Noir',amount:17000,status:'confirmée',category:'Accessoires',date:new Date(Date.now() - 5*24*60*60*1000).toISOString()}
];
// Une nouvelle boutique démarre vide : les exemples (defaults) ne se chargent qu'à la demande (loadDemoData).
let products = read(productKey, []).map(product => migrateProduct({...product, category:product.category || (product.style === 'care' ? 'Cosmétiques' : product.style === 'bag' ? 'Accessoires' : 'Vêtements')}));
// Convertit une commande enregistrée à l'ancien format vers le nouveau : ajoute category, date (horodatage estimé) et customerId si absents.
// `knownOrders` est le tableau déjà migré jusqu'ici dans la même passe (voir plus bas) : orders n'existe pas encore pendant cette construction initiale,
// donc on ne peut pas s'appuyer dessus pour retrouver un identifiant client existant au sein du même lot.
function migrateOrder(order, knownOrders) {
  const category = order.category || (order.product.includes('Sac') ? 'Accessoires' : 'Vêtements');
  const date = order.date || new Date().toISOString();
  const customerId = order.customerId || getOrCreateCustomerId(order.customer, knownOrders);
  return { ...order, category, date, customerId };
}
// Associe un nom de client à un identifiant stable (Client #001, #002...). Même nom exact tapé -> même identifiant.
// `knownOrders` : liste de commandes déjà connues (orders en temps normal, ou l'accumulateur local pendant la migration initiale) où chercher un identifiant existant.
function getOrCreateCustomerId(customerName, knownOrders) {
  const pool = knownOrders !== undefined ? knownOrders : orders;
  const existing = pool.find(order => order.customer === customerName);
  if (existing) return existing.customerId;
  const usedNumbers = pool.map(order => Number(String(order.customerId || '').replace('c', ''))).filter(n => !isNaN(n));
  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  return `c${nextNumber}`;
}
let orders = read(orderKey, []).reduce((migrated, order) => [...migrated, migrateOrder(order, migrated)], []);
let activeProduct = products[0];
let categories = read('oja-categories', []);
let activeCategory = categories[0] || 'Vêtements';
let activeOrderStatus = 'Toutes';
let ordersSearchQuery = '';
let customersSearchQuery = '';
let shopProfile = { ...defaultProfile, ...read(profileKey, {}) }; // fusion : un profil enregistré avant l'ajout d'un champ garde ses valeurs et reçoit les nouveaux champs vides
let escalations = read(escalationKey, []); // { id, productId, productName, customerName, message, date }

// Lecture/écriture via store.js : localStorage ou serveur, l'app ne fait pas la différence.
function read(key, fallback) { try { const value = STORE.get(key); return value === null || value === undefined ? fallback : value; } catch { return fallback; } }
function save(key, value) { STORE.set(key, value); }
// Convertit un produit enregistré à l'ancien format texte vers le nouveau format structuré.
// Vêtements : sizes/colors (texte) -> size/color ({mode, values}), sizeType par défaut Standard.
// Vêtements (2e niveau) : size sans sizeType -> ajoute sizeType Standard (articles créés avant l'introduction du type de taille).
// Cosmétiques : sizes/colors -> productType/shade/volume/length/texture. Cosmétiques (2e niveau) : productType sans length/texture -> les ajoute inactifs.
// Accessoires : sizes/colors -> itemType/color/dimension. Accessoires (2e niveau) : dimension sans dimensionType -> ajoute dimensionType Format.
function migrateProduct(product) {
  const toChoice = (text) => { const values = String(text || '').split(',').map(v => v.trim()).filter(Boolean); return { mode: values.length > 1 ? 'plusieurs' : 'unique', values: values.length ? values : [''] }; };
  if (product.category === 'Vêtements' && !product.size) {
    const { sizes, colors, ...rest } = product;
    return { ...rest, size: { sizeType:'Standard', ...toChoice(sizes) }, color: toChoice(colors), material: product.material || '', gender: product.gender || '', setContent: product.setContent || '', rangeName: product.rangeName || '' };
  }
  if (product.category === 'Vêtements' && product.size && !product.size.sizeType) {
    return { ...product, size: { sizeType:'Standard', ...product.size } };
  }
  if (product.category === 'Cosmétiques' && !product.productType) {
    const { sizes, colors, ...rest } = product;
    return { ...rest, productType: product.name || '', shade:{active:false,mode:'unique',values:['']}, volume:{active:false,mode:'unique',values:['']}, length:{active:false,mode:'unique',values:['']}, texture:{active:false,mode:'unique',values:['']}, expiryDate:'', boxContent:'', rangeName:'' };
  }
  if (product.category === 'Cosmétiques' && product.productType !== undefined && !product.length) {
    return { ...product, length:{active:false,mode:'unique',values:['']}, texture:{active:false,mode:'unique',values:['']} };
  }
  if (product.category === 'Accessoires' && !product.itemType) {
    const { sizes, colors, ...rest } = product;
    return { ...rest, itemType: product.name || '', color: toChoice(colors), material: product.material || '', dimension:{active:false,dimensionType:'Format',mode:'unique',values:['']}, packContent:'', rangeName: product.rangeName || '' };
  }
  if (product.category === 'Accessoires' && product.itemType !== undefined && product.dimension && !product.dimension.dimensionType) {
    return { ...product, dimension: { dimensionType:'Format', ...product.dimension } };
  }
  // Migration media : l'ancien format n'avait qu'une seule image (chaîne) et un flag vidéo
  // booléen sans donnée réelle. Le nouveau format permet jusqu'à 3 photos + 1 vraie vidéo,
  // avec wornCount qui compte combien des DERNIÈRES photos uploadées sont des photos "portées".
  if (!product.media) {
    const { image, video, ...rest } = product;
    return { ...rest, media: { photos: image ? [image] : [], wornCount: 0, video: '', variants: [] } };
  }
  if (!product.media.variants) return { ...product, media: { ...product.media, variants: [] } };
  return product;
}
function esc(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function money(value) { return `${Number(value).toLocaleString('fr-FR')} FCFA`; }
function initials(name) { return name.split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase(); }
function showToast(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }

function renderCategoryChoices() {
  document.querySelectorAll('[data-category]').forEach(button => button.classList.toggle('selected', categories.includes(button.dataset.category)));
  const label = categories.length ? `Votre boutique : ${categories.join(' · ')}` : 'Aucune catégorie sélectionnée';
  document.querySelector('#selected-categories').textContent = label;
  document.querySelector('#continue-button').disabled = !categories.length;
}
function renderCategorySelect(selected='') {
  const select = document.querySelector('#product-category');
  const options = categories.length ? categories : ['Vêtements','Cosmétiques','Accessoires'];
  select.innerHTML = options.map(category => `<option value="${category}" ${category === selected ? 'selected' : ''}>${category}</option>`).join('');
  toggleCategoryFields(select.value);
}
// Affiche uniquement le bloc de champs correspondant à la catégorie choisie dans le formulaire produit.
// Désactive aussi le "required" des champs masqués : un champ requis invisible bloque la validation du formulaire.
// Met aussi à jour le placeholder du nom d'article avec un exemple propre à la catégorie.
function toggleCategoryFields(category) {
  document.querySelectorAll('.category-fields').forEach(block => {
    const isVisible = block.id === `fields-${category}`;
    block.classList.toggle('hidden', !isVisible);
    block.querySelectorAll('[data-required-when-visible]').forEach(field => { field.required = isVisible; });
  });
  const namePlaceholders = {'Vêtements':'Ex. Robe satin beige','Cosmétiques':'Ex. Gel douche Roger&Gallet','Accessoires':'Ex. Montre Casio'};
  document.querySelector('#product-name').placeholder = namePlaceholders[category] || 'Ex. Robe satin beige';
}
// Met à jour le placeholder du champ valeurs de taille selon le type choisi (Standard/Soutien-gorge/Culotte-bas).
function updateSizeTypePlaceholder() {
  const sizeTypePlaceholders = {'Standard':'Ex. M ou S, M, L','Soutien-gorge':'Ex. 85B ou 85B, 90C','Culotte-bas':'Ex. M ou S, M, L'};
  const type = document.querySelector('#clothes-size-type').value;
  document.querySelector('#clothes-size-values').placeholder = sizeTypePlaceholders[type] || 'Ex. M ou S, M, L';
}
// Met à jour le placeholder du champ valeurs de dimension selon le type choisi (Format/Taille-bague) pour Accessoires.
function updateDimensionTypePlaceholder() {
  const dimensionTypePlaceholders = {'Format':'Ex. Petit format ou Petit format, Grand format','Taille-bague':'Ex. 54 ou 52, 54, 56'};
  const type = document.querySelector('#accessories-dimension-type').value;
  document.querySelector('#accessories-dimension-values').placeholder = dimensionTypePlaceholders[type] || 'Ex. Petit format ou Petit format, Grand format';
}
function renderCategoryTabs() {
  const copy = {Vêtements:'Tailles, couleurs, stock et nouveautés de votre collection.',Cosmétiques:'Teintes, formats, ingrédients et soins disponibles dans votre boutique.',Accessoires:'Modèles, couleurs et détails de vos sacs, bijoux, montres et lunettes.'};
  document.querySelectorAll('.category-tabs').forEach(container => {
    container.innerHTML = categories.map(category => `<button class="category-tab ${category === activeCategory ? 'active' : ''}" data-shop-category="${category}">${category}</button>`).join('');
  });
  document.querySelector('#category-context').textContent = copy[activeCategory] || '';
  document.querySelector('#products-title').textContent = activeCategory === 'Vêtements' ? 'Ma collection vêtements' : activeCategory === 'Cosmétiques' ? 'Mes produits cosmétiques' : 'Mes accessoires';
  document.querySelector('#catalog-title').textContent = `Catalogue ${activeCategory.toLowerCase()}`;
  document.querySelectorAll('[data-shop-category]').forEach(button => button.addEventListener('click', () => selectCategory(button.dataset.shopCategory)));
}
function selectCategory(category) {
  activeCategory = category;
  activeProduct = products.find(product => product.category === category) || null;
  renderWorkspace();
}
function renderWorkspace() {
  renderCategoryTabs(); renderProducts(); renderOrders(); renderFirstStep();
  if (!document.querySelector('#orders-view').classList.contains('hidden')) renderOrdersView();
  if (!document.querySelector('#customers-view').classList.contains('hidden')) renderCustomersView();
}
function openCategories() { document.querySelector('#onboarding').classList.remove('hidden'); renderCategoryChoices(); }

// Affiche le profil vendeuse dans la sidebar (avatar, nom, boutique). Appelé au chargement et après chaque sauvegarde du modal Infos boutique.
function renderProfile() {
  document.querySelector('#profile-seller-name').textContent = shopProfile.sellerName;
  document.querySelector('#profile-shop-name').textContent = shopProfile.shopName;
  const avatar = document.querySelector('#profile-avatar');
  avatar.innerHTML = shopProfile.photo ? `<img src="${shopProfile.photo}" alt="">` : initials(shopProfile.sellerName || 'JK');
  const mobileAvatar = document.querySelector('#mobile-profile-avatar');
  mobileAvatar.innerHTML = shopProfile.photo ? `<img src="${shopProfile.photo}" alt="">` : initials(shopProfile.sellerName || 'JK');
  document.querySelector('#home-greeting-name').textContent = (shopProfile.sellerName || 'Josie').split(' ')[0];
  renderRules();
  // En-tête du simulateur WhatsApp : nom de la boutique et logo (ou initiale) tels que la cliente les voit.
  document.querySelector('#phone-shop-name').textContent = shopProfile.shopName;
  document.querySelector('#phone-shop-avatar').innerHTML = shopProfile.logo ? `<img src="${shopProfile.logo}" alt="">` : (shopProfile.shopName || 'J')[0].toUpperCase();
}

// Règles de vente affichées dans le Catalogue : toujours dérivées du profil, jamais en dur —
// c'est exactement ce qu'Ọjà dira aux clientes, donc les deux doivent rester synchronisés.
function renderRules() {
  const delivery = deliveryAvailable()
    ? `${esc(shopProfile.deliveryZone)}, ${money(Number(shopProfile.deliveryFee))}${shopProfile.deliveryDelay ? ` (${esc(shopProfile.deliveryDelay)})` : ''}`
    : 'Non renseignée — les clientes ne peuvent que retirer à la boutique';
  const hours = shopProfile.hours ? esc(shopProfile.hours) : 'Non renseignés — Ọjà transfère la question';
  document.querySelector('#rule-grid').innerHTML = `<p><strong>Livraison</strong> ${delivery}</p><p><strong>Horaires</strong> ${hours}</p><p><strong>Paiement</strong> Orange Money, Moov Money, Wave ou à la livraison</p><p><strong>Paiement échelonné</strong> ${shopProfile.installmentMin && shopProfile.installmentPercent ? `À partir de ${money(Number(shopProfile.installmentMin))}, ${esc(shopProfile.installmentPercent)} % d'avance` : 'Non configuré — Ọjà transfère la demande à la boutique'}</p>`;
}

// Date du jour en français pour l'en-tête de l'Accueil (ex. « SAMEDI 5 SEPTEMBRE »).
function renderHomeDate() {
  const label = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelector('#home-date').textContent = label.charAt(0).toUpperCase() + label.slice(1);
}

// Pré-remplit et ouvre le modal Infos boutique avec les valeurs actuelles du profil.
function openProfile() {
  document.querySelector('#profile-shop-name-input').value = shopProfile.shopName;
  document.querySelector('#profile-seller-name-input').value = shopProfile.sellerName;
  document.querySelector('#profile-contact-input').value = shopProfile.contact;
  document.querySelector('#profile-description-input').value = shopProfile.description;
  document.querySelector('#profile-hours-input').value = shopProfile.hours;
  document.querySelector('#profile-delivery-delay-input').value = shopProfile.deliveryDelay;
  document.querySelector('#profile-delivery-zone-input').value = shopProfile.deliveryZone;
  document.querySelector('#profile-delivery-fee-input').value = shopProfile.deliveryFee;
  document.querySelector('#profile-installment-min-input').value = shopProfile.installmentMin || '';
  document.querySelector('#profile-installment-percent-input').value = shopProfile.installmentPercent || '';
  const preview = document.querySelector('#profile-photo-preview');
  preview.innerHTML = shopProfile.photo ? `<img src="${shopProfile.photo}" alt="">` : initials(shopProfile.sellerName || 'JK');
  const logoPreview = document.querySelector('#profile-logo-preview');
  logoPreview.innerHTML = shopProfile.logo ? `<img src="${shopProfile.logo}" alt="">` : 'Aucun logo';
  document.querySelector('#profile-modal').showModal();
}

// Enregistre les modifications du modal Infos boutique dans shopProfile, persiste, et rafraîchit la sidebar.
function submitProfile() {
  shopProfile = {
    shopName: document.querySelector('#profile-shop-name-input').value.trim() || defaultProfile.shopName,
    sellerName: document.querySelector('#profile-seller-name-input').value.trim() || defaultProfile.sellerName,
    contact: document.querySelector('#profile-contact-input').value.trim(),
    description: document.querySelector('#profile-description-input').value.trim(),
    hours: document.querySelector('#profile-hours-input').value.trim(),
    deliveryDelay: document.querySelector('#profile-delivery-delay-input').value.trim(),
    deliveryZone: document.querySelector('#profile-delivery-zone-input').value.trim(),
    deliveryFee: document.querySelector('#profile-delivery-fee-input').value.trim(),
    installmentMin: document.querySelector('#profile-installment-min-input').value.trim(),
    installmentPercent: document.querySelector('#profile-installment-percent-input').value.trim(),
    photo: shopProfile.photo,
    logo: shopProfile.logo
  };
  save(profileKey, shopProfile);
  renderProfile();
  document.querySelector('#profile-modal').close();
  showToast('Infos boutique enregistrées.');
}

// Les 6 clés localStorage utilisées par ce prototype — recensées une fois ici plutôt que
// dispersées, pour que l'export et la réinitialisation restent exhaustifs et synchronisés
// si une nouvelle clé est ajoutée un jour (il suffira de l'ajouter à cette seule liste).
const settingsKey = 'oja-settings';
let settings = read(settingsKey, { sound: false, firstStepDismissed: false, assistant: { provider: 'none', url: 'http://localhost:11434', model: 'qwen2.5:7b' } });
function saveSettings() { save(settingsKey, settings); }
const ALL_STORAGE_KEYS = [productKey, orderKey, profileKey, escalationKey, 'oja-categories', 'oja-conversations', settingsKey];
// Le thème est une préférence d'appareil : il reste dans le navigateur, même en mode serveur.

function openSettings() {
  document.querySelector('#reset-data-confirm').classList.add('hidden');
  document.querySelector('#sound-toggle').checked = Boolean(settings.sound);
  renderAssistantSettings();
  document.querySelector('#settings-modal').showModal();
}

// Rassemble les 6 clés du prototype dans un objet, puis déclenche un téléchargement .json
// via un lien temporaire (pattern standard navigateur, pas de dépendance externe nécessaire).
function exportData() {
  const data = {};
  ALL_STORAGE_KEYS.forEach(key => { data[key] = read(key, null); });
  data['oja-theme'] = localStorage.getItem('oja-theme'); // préférence d'appareil, incluse pour un export complet
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `oja-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Export téléchargé.');
}

// Export des commandes en CSV (séparateur point-virgule, lisible par Excel en français).
function exportOrdersCsv() {
  const header = ['Date', 'Cliente', 'Article(s)', 'Montant (FCFA)', 'Statut', 'Catégorie'];
  const rows = orders.map(order => [new Date(order.date).toLocaleDateString('fr-FR'), order.customer, order.product, order.amount, order.status, order.category]);
  const cell = value => `"${String(value).replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [header, ...rows].map(row => row.map(cell).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `oja-commandes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  showToast('Tableau des commandes téléchargé.');
}

// Petit son (deux notes) quand une conversation attend la vendeuse. Sans fichier audio :
// synthèse WebAudio, uniquement si activé dans Réglages.
function playNotification() {
  if (!settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [880, 0.12]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.25);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.3);
    });
  } catch { /* navigateur sans WebAudio : silence */ }
}

// Parcours de démarrage en 3 étapes sur l'Accueil : visible tant que tout n'est pas fait
// (ou que la vendeuse ne l'a pas masqué). Les articles d'exemple ne comptent pas comme
// « premier article ».
const DEMO_IDS = new Set(['robe', 'sac', 'glow']);
function renderFirstStep() {
  const ownProducts = products.filter(product => !DEMO_IDS.has(product.id));
  const steps = [categories.length > 0, ownProducts.length > 0, threads.some(thread => thread.persisted && thread.messages.some(m => m.from === 'oja'))];
  steps.forEach((done, index) => document.querySelector(`#first-step-${index + 1}`).classList.toggle('done', done));
  const allDone = steps.every(Boolean);
  document.querySelector('#first-step').classList.toggle('hidden', allDone || settings.firstStepDismissed);
  document.querySelector('#first-step-add').classList.toggle('hidden', steps[1]);
}

// Supprime explicitement les 6 clés connues plutôt que localStorage.clear() — plus sûr si
// d'autres données non liées à Ọjà venaient à partager le même domaine en environnement de test.
function resetAllData() {
  ALL_STORAGE_KEYS.forEach(key => STORE.remove(key));
  localStorage.removeItem('oja-theme');
  location.reload();
}

// La livraison à domicile n'est proposée que si Josie a renseigné à la fois une zone ET un
// tarif dans son profil — sinon on ne peut ni afficher un message honnête, ni calculer un total.
function deliveryAvailable() {
  return Boolean(shopProfile.deliveryZone) && shopProfile.deliveryFee !== '' && !Number.isNaN(Number(shopProfile.deliveryFee));
}

function art(product, large=false) {
  const firstPhoto = product.media.photos[0];
  const media = firstPhoto ? `<img src="${firstPhoto}" alt="${esc(product.name)}">` : `<span>${product.style === 'dress' ? 'Robe' : product.style === 'bag' ? '⌒' : '✦'}</span>`;
  const label = product.media.video ? '▶ Vidéo' : product.media.photos.length ? `Photo${product.media.photos.length > 1 ? `s (${product.media.photos.length})` : ''}` : 'Sans image';
  return `<div class="product-art ${product.style || 'dress'}${large ? ' large' : ''}">${media}<b>${label}</b></div>`;
}

// Résumé court affiché sur la fiche catalogue : taille/couleur pour un vêtement, type/teinte/volume pour un cosmétique (nouveau format), ancien texte sinon.
function productSummary(product) {
  if (product.category === 'Vêtements' && product.size) {
    const parts = [];
    if (product.size.values[0]) parts.push(product.size.mode === 'unique' ? `Taille ${product.size.values[0]}` : `Tailles ${product.size.values.join(', ')}`);
    if (product.color.values[0]) parts.push(product.color.mode === 'unique' ? product.color.values[0] : product.color.values.join(', '));
    return parts.join(' · ') || `${product.stock} disponibles`;
  }
  if (product.category === 'Cosmétiques' && product.productType !== undefined) {
    const parts = [product.productType];
    if (product.shade.active && product.shade.values[0]) parts.push(product.shade.values.join(', '));
    if (product.volume.active && product.volume.values[0]) parts.push(product.volume.values.join(', '));
    return parts.filter(Boolean).join(' · ') || `${product.stock} disponibles`;
  }
  if (product.category === 'Accessoires' && product.itemType !== undefined) {
    const parts = [product.itemType];
    if (product.color.values[0]) parts.push(product.color.mode === 'unique' ? product.color.values[0] : product.color.values.join(', '));
    if (product.dimension.active && product.dimension.values[0]) parts.push(product.dimension.values.join(', '));
    return parts.filter(Boolean).join(' · ') || `${product.stock} disponibles`;
  }
  return product.sizes || product.colors || `${product.stock} disponibles`;
}

function renderProducts() {
  const home = document.querySelector('#home-products');
  const catalog = document.querySelector('#catalog-products');
  const selectedProducts = products.filter(product => product.category === activeCategory);
  home.innerHTML = (selectedProducts.length ? '' : '<div class="empty-state product-empty">Votre catalogue est vide pour l\'instant. Ajoutez votre premier article : c\'est tout ce dont Ọjà a besoin pour commencer.</div>') + selectedProducts.slice(0,3).map(product => `<article class="product-card" data-chat-product="${product.id}">${art(product)}<strong>${esc(product.name)}</strong><p>${money(product.price)}<br>${product.stock} en stock</p></article>`).join('') + `<button class="add-product" data-action="add"><span>＋</span> Ajouter<br>un article</button>`;
  const inStock = products.filter(product => Number(product.stock) > 0).length;
  document.querySelector('#catalog-status-text').textContent = inStock ? `${inStock} produit${inStock > 1 ? 's sont disponibles' : ' est disponible'} dans vos conversations WhatsApp.` : 'Aucun produit en stock pour l\'instant.';
  catalog.innerHTML = selectedProducts.length ? selectedProducts.map(product => `<article class="catalog-item">${art(product,true)}<div class="catalog-copy"><span class="stock">● ${product.stock > 0 ? 'En stock' : 'Rupture de stock'}</span><h3>${esc(product.name)}</h3><p>${money(product.price)} · ${esc(productSummary(product))}</p><div><button data-action="edit" data-id="${product.id}">Modifier</button><button data-chat-product="${product.id}">Simuler une cliente</button><button class="delete-product" data-action="delete" data-id="${product.id}">Supprimer</button></div></div></article>`).join('') : `<div class="empty-state">Votre catalogue ${activeCategory.toLowerCase()} est vide. Ajoutez votre premier article.</div>`;
  document.querySelectorAll('[data-chat-product]').forEach(button => button.addEventListener('click', () => selectProduct(button.dataset.chatProduct)));
  document.querySelectorAll('[data-action="add"]').forEach(button => button.addEventListener('click', openAdd));
  document.querySelectorAll('[data-action="edit"]').forEach(button => button.addEventListener('click', () => openEdit(button.dataset.id)));
  document.querySelectorAll('[data-action="delete"]').forEach(button => button.addEventListener('click', () => removeProduct(button.dataset.id)));
}

function renderOrders() {
  const list = document.querySelector('#order-list');
  const activeEscalations = escalations.filter(escalation => {
    const product = products.find(item => item.id === escalation.productId);
    return product ? product.category === activeCategory : true;
  });
  const escalationsHtml = activeEscalations.map(escalation => `<div class="order escalation" data-escalation-id="${escalation.id}" title="Cliquer pour rouvrir cette conversation"><div class="customer escalation-icon">💬</div><div><strong>${esc(escalation.customerName)}</strong><p>${esc(escalation.message)}</p></div><div class="amount"><small>${timeAgo(escalation.date)}</small></div><span class="status pending">à répondre</span></div>`).join('');
  const selectedOrders = orders.filter(order => order.category === activeCategory);
  const ordersHtml = selectedOrders.length ? selectedOrders.slice(0,4).map((order,index) => `<div class="order"><div class="customer ${index % 2 ? 'yellow' : 'pink'}">${initials(order.customer)}</div><div><strong>${esc(order.customer)}</strong><p>${esc(order.product)}</p></div><div class="amount">${Number(order.amount).toLocaleString('fr-FR')} <small>FCFA</small></div><span class="status ${order.status === 'confirmée' || order.status === 'livrée' ? 'ready' : 'pending'}" data-order-id="${order.id}" title="Cliquer pour changer le statut">${esc(order.status)}</span></div>`).join('') : '';
  list.innerHTML = escalationsHtml + ordersHtml || `<div class="empty-state">Aucune commande dans cette catégorie pour le moment.</div>`;
  document.querySelector('#today-orders').textContent = selectedOrders.length;
  document.querySelector('#order-count').textContent = orders.length;
  document.querySelector('#chatting-count').textContent = threads.filter(thread => thread.status !== 'closed').length;
  document.querySelector('#revenue').innerHTML = `${selectedOrders.reduce((total, order) => total + Number(order.amount), 0).toLocaleString('fr-FR')} <em>FCFA</em>`;
  // Chiffres de l'Accueil mobile : volontairement calculés sur `orders`/`escalations` bruts (pas
  // `selectedOrders`, filtré par activeCategory) — la maquette validée demande une vue globale
  // toutes catégories ici, seul endroit de l'app où ça a du sens (tout le reste reste filtré).
  const globalPendingOrders = orders.filter(order => order.status !== 'confirmée' && order.status !== 'livrée').length;
  document.querySelector('#mobile-pending-count').textContent = globalPendingOrders + escalations.length;
  document.querySelector('#mobile-today-total').textContent = `${orders.reduce((total, order) => total + Number(order.amount), 0).toLocaleString('fr-FR')} FCFA`;
  document.querySelectorAll('#order-list [data-order-id]').forEach(button => button.addEventListener('click', () => advanceOrder(button.dataset.orderId)));
  document.querySelectorAll('#order-list [data-escalation-id]').forEach(card => card.addEventListener('click', () => openEscalation(card.dataset.escalationId)));
}

// Ouvre la conversation exacte liée à une alerte (clic depuis le bloc À traiter de l'Accueil) :
// sélectionne le produit concerné, ce qui recharge le simulateur sur cette conversation précise,
// puis retire l'alerte — Josie l'a vue et peut reprendre la main directement dans le chat.
function openEscalation(id) {
  const escalation = escalations.find(item => item.id === id);
  if (!escalation) return;
  escalations = escalations.filter(item => item.id !== id);
  save(escalationKey, escalations);
  const thread = threads.find(item => item.id === escalation.threadId);
  if (thread) { thread.needsSeller = false; openThread(thread.id); showToast(`Conversation avec ${escalation.customerName} ouverte.`); return; }
  if (escalation.productId && products.some(item => item.id === escalation.productId)) {
    selectProduct(escalation.productId);
  } else {
    renderOrders();
  }
  showToast(`Conversation avec ${escalation.customerName} ouverte.`);
}

function advanceOrder(id) {
  const states = ['à confirmer','confirmée','en livraison','livrée'];
  const order = orders.find(item => item.id === id);
  const index = states.indexOf(order.status);
  if (index === states.length - 1) { showToast('Cette commande est déjà livrée.'); return; }
  order.status = states[index + 1];
  save(orderKey, orders); renderOrders(); showToast(`Commande ${order.status}.`);
  if (!document.querySelector('#orders-view').classList.contains('hidden')) renderOrdersView();
}

// Formule une ancienneté lisible ("à l'instant", "il y a 3h", "il y a 2j") à partir d'un ISO string.
function timeAgo(isoDate) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / (60*60*1000));
  if (hours < 1) return "à l'instant";
  if (hours < 24) return `il y a ${hours}h`;
  return `il y a ${Math.floor(hours / 24)}j`;
}

// Rend la vue Commandes dédiée : statistiques, onglets de statut, recherche, liste complète (sans limite de 4), filtrées par catégorie active.
function renderOrdersView() {
  const ORDER_STATES = ['à confirmer','confirmée','en livraison','livrée'];
  const categoryOrders = orders.filter(order => order.category === activeCategory);

  // Statistiques (toujours calculées sur la catégorie active entière, indépendamment du filtre de statut ou de recherche affiché).
  const total = categoryOrders.reduce((sum, order) => sum + Number(order.amount), 0);
  const average = categoryOrders.length ? Math.round(total / categoryOrders.length) : 0;
  const salesByProduct = {};
  categoryOrders.forEach(order => { const name = order.product.split(' · ')[0]; salesByProduct[name] = (salesByProduct[name] || 0) + 1; });
  const topProducts = Object.entries(salesByProduct).sort((a, b) => b[1] - a[1]).slice(0, 3);
  document.querySelector('#orders-stats').innerHTML = `
    <div class="stat-card mobile-priority"><p class="eyebrow">Commandes</p><strong>${categoryOrders.length}</strong></div>
    <div class="stat-card mobile-extra"><p class="eyebrow">Total</p><strong>${total.toLocaleString('fr-FR')} <em>FCFA</em></strong></div>
    <div class="stat-card mobile-priority"><p class="eyebrow">Panier moyen</p><strong>${average.toLocaleString('fr-FR')} <em>FCFA</em></strong></div>
    <div class="stat-card mobile-extra"><p class="eyebrow">Top produits</p>${topProducts.length ? topProducts.map(([name, count]) => `<p>${esc(name)} <em>×${count}</em></p>`).join('') : '<p>Aucune vente encore.</p>'}</div>
  `;

  // Onglets de statut.
  document.querySelector('#orders-status-tabs').innerHTML = ['Toutes', ...ORDER_STATES].map(status => `<button class="status-tab ${status === activeOrderStatus ? 'active' : ''}" data-status="${esc(status)}">${esc(status.charAt(0).toUpperCase() + status.slice(1))}</button>`).join('');
  document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { activeOrderStatus = button.dataset.status; renderOrdersView(); }));

  // Liste déroulante des noms de clients distincts de la catégorie, pour la recherche assistée.
  const distinctCustomers = [...new Set(categoryOrders.map(order => order.customer))];
  document.querySelector('#orders-customer-list').innerHTML = distinctCustomers.map(name => `<option value="${esc(name)}"></option>`).join('');

  // Application des filtres (statut + recherche texte) pour la liste affichée.
  const filtered = categoryOrders
    .filter(order => activeOrderStatus === 'Toutes' || order.status === activeOrderStatus)
    .filter(order => !ordersSearchQuery || order.customer.toLowerCase().includes(ordersSearchQuery.toLowerCase()))
    .slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  document.querySelector('#orders-list-full').innerHTML = filtered.length ? filtered.map((order, index) => `<div class="order"><div class="customer ${index % 2 ? 'yellow' : 'pink'}">${initials(order.customer)}</div><div><strong>${esc(order.customer)}</strong><p>${esc(order.product)}</p><small>${timeAgo(order.date)}</small></div><div class="amount">${Number(order.amount).toLocaleString('fr-FR')} <small>FCFA</small></div><span class="status ${order.status === 'confirmée' || order.status === 'livrée' ? 'ready' : 'pending'}" data-order-id="${order.id}" title="Cliquer pour changer le statut">${esc(order.status)}</span></div>`).join('') : `<div class="empty-state">Aucune commande ne correspond à ce filtre.</div>`;
  document.querySelectorAll('#orders-list-full [data-order-id]').forEach(button => button.addEventListener('click', () => advanceOrder(button.dataset.orderId)));
}
document.querySelector('#orders-search-input').addEventListener('input', event => { ordersSearchQuery = event.target.value; renderOrdersView(); });
document.querySelector('#customers-search-input').addEventListener('input', event => { customersSearchQuery = event.target.value; renderCustomersView(); });
document.querySelector('#orders-stats-toggle').addEventListener('click', () => {
  const grid = document.querySelector('#orders-stats');
  const expanded = grid.classList.toggle('expanded');
  document.querySelector('#orders-stats-toggle').innerHTML = expanded ? 'Réduire <span>▴</span>' : 'Voir total et top produits <span>▾</span>';
});

// Rend la vue Clients dédiée : une carte par client ayant commandé dans la catégorie active, triées par date de dernière commande.
function renderCustomersView() {
  const categoryOrders = orders.filter(order => order.category === activeCategory);
  const customerIds = [...new Set(categoryOrders.map(order => order.customerId))];
  const customerCards = customerIds.map(customerId => {
    const customerOrders = categoryOrders.filter(order => order.customerId === customerId).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const name = customerOrders[0].customer;
    const total = customerOrders.reduce((sum, order) => sum + Number(order.amount), 0);
    return { customerId, name, total, lastOrderDate: customerOrders[0].date, orderCount: customerOrders.length };
  }).filter(customer => !customersSearchQuery || customer.name.toLowerCase().includes(customersSearchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.lastOrderDate) - new Date(a.lastOrderDate));

  document.querySelector('#customers-grid').innerHTML = customerCards.length ? customerCards.map((customer, index) => `<button class="customer-card" data-customer-id="${esc(customer.customerId)}"><div class="customer ${index % 2 ? 'yellow' : 'pink'}">${initials(customer.name)}</div><div><strong>${esc(customer.name)}</strong><p>${customer.orderCount} commande${customer.orderCount > 1 ? 's' : ''} · ${timeAgo(customer.lastOrderDate)}</p></div><div class="amount">${customer.total.toLocaleString('fr-FR')} <small>FCFA</small></div></button>`).join('') : `<div class="empty-state">${customersSearchQuery ? 'Aucun client ne correspond à cette recherche.' : 'Aucun client dans cette catégorie pour le moment.'}</div>`;
  document.querySelectorAll('[data-customer-id]').forEach(card => card.addEventListener('click', () => openCustomerModal(card.dataset.customerId)));
}

// Ouvre la fiche complète d'un client : total dépensé toutes catégories, et historique de ses commandes dans la catégorie active.
function openCustomerModal(customerId) {
  const allCustomerOrders = orders.filter(order => order.customerId === customerId);
  const categoryOrders = allCustomerOrders.filter(order => order.category === activeCategory).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const name = allCustomerOrders[0].customer;
  const totalAllCategories = allCustomerOrders.reduce((sum, order) => sum + Number(order.amount), 0);
  document.querySelector('#customer-modal-name').textContent = name;
  document.querySelector('#customer-modal-summary').innerHTML = `<div class="stat-card"><p class="eyebrow">Commandes (toutes catégories)</p><strong>${allCustomerOrders.length}</strong></div><div class="stat-card"><p class="eyebrow">Total dépensé (toutes catégories)</p><strong>${totalAllCategories.toLocaleString('fr-FR')} <em>FCFA</em></strong></div>`;
  document.querySelector('#customer-modal-history').innerHTML = categoryOrders.length ? categoryOrders.map(order => `<div class="order"><div><strong>${esc(order.product)}</strong><p>${timeAgo(order.date)}</p></div><div class="amount">${Number(order.amount).toLocaleString('fr-FR')} <small>FCFA</small></div><span class="status ${order.status === 'confirmée' || order.status === 'livrée' ? 'ready' : 'pending'}">${esc(order.status)}</span></div>`).join('') : `<div class="empty-state">Aucune commande dans cette catégorie.</div>`;
  document.querySelector('#customer-modal').showModal();
}
document.querySelector('.close-customer-modal').addEventListener('click', () => document.querySelector('#customer-modal').close());
document.querySelector('#profile-button').addEventListener('click', openProfile);
document.querySelector('.close-profile-modal').addEventListener('click', () => document.querySelector('#profile-modal').close());
document.querySelector('.cancel-profile-button').addEventListener('click', () => document.querySelector('#profile-modal').close());
document.querySelector('#settings-button').addEventListener('click', openSettings);
document.querySelector('.close-settings-modal').addEventListener('click', () => document.querySelector('#settings-modal').close());
document.querySelector('#export-data-button').addEventListener('click', exportData);
document.querySelector('#export-orders-button').addEventListener('click', exportOrdersCsv);
['#assistant-provider', '#assistant-url', '#assistant-model'].forEach(id => document.querySelector(id).addEventListener('change', saveAssistantSettings));
document.querySelector('#assistant-test-button').addEventListener('click', testAssistantConnection);
document.querySelector('#sound-toggle').addEventListener('change', event => { settings.sound = event.target.checked; saveSettings(); if (settings.sound) playNotification(); });
document.querySelector('#first-step-add').addEventListener('click', openAdd);
document.querySelector('#first-step-dismiss').addEventListener('click', () => { settings.firstStepDismissed = true; saveSettings(); renderFirstStep(); });
document.querySelector('#reset-data-button').addEventListener('click', () => document.querySelector('#reset-data-confirm').classList.remove('hidden'));
document.querySelector('#reset-data-cancel').addEventListener('click', () => document.querySelector('#reset-data-confirm').classList.add('hidden'));
document.querySelector('#reset-data-confirm-button').addEventListener('click', resetAllData);
document.querySelector('#profile-form').addEventListener('submit', event => { event.preventDefault(); submitProfile(); });
document.querySelector('#profile-photo-input').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { shopProfile = { ...shopProfile, photo: reader.result }; document.querySelector('#profile-photo-preview').innerHTML = `<img src="${reader.result}" alt="">`; };
  reader.readAsDataURL(file);
});
document.querySelector('#profile-logo-input').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { shopProfile = { ...shopProfile, logo: reader.result }; document.querySelector('#profile-logo-preview').innerHTML = `<img src="${reader.result}" alt="">`; };
  reader.readAsDataURL(file);
});

// Fil de démarrage : l'exemple « robe beige / taille M », affiché à chaque chargement sans
// être enregistré tant que Josie n'interagit pas avec.
function startDemoThread() {
  const product = activeProduct;
  if (!product) {
    activeThread = null;
    chat.innerHTML = '<div class="date-pill">Aujourd\'hui</div><div class="phone-empty">Ajoutez un article dans votre catalogue : Ọjà commencera à répondre ici, comme il le fera à vos clientes.</div>';
    suggestions.innerHTML = '';
    renderPhoneState();
    return;
  }
  newThread(product, { seed: [
    { from: 'customer', kind: 'text', body: 'Bonjour, est-ce que la robe beige est toujours disponible ?' },
    { from: 'oja', kind: 'text', body: `Bonjour et bienvenue chez ${shopName()} 🌷<br><br>Oui, notre robe satin beige est disponible. Elle est à <strong>18 500 FCFA</strong>. Quelle taille vous intéresse, s'il vous plaît ?` },
    { from: 'customer', kind: 'text', body: 'Taille M, je veux la commander.' }
  ] });
  setChoices([{ id: 'size', label: 'Confirmer la taille M' }, { id: 'order', label: 'Prendre la commande' }]);
  if (product) resumeDialogueSilently(product);
  renderPhoneState();
}
function resetToStaticExample() { startDemoThread(); }

function selectProduct(id) {
  activeProduct = products.find(product => product.id === id) || products[0];
  activeCategory = activeProduct.category;
  document.querySelector('#home-view').classList.remove('hidden');
  document.querySelector('#catalog-view').classList.add('hidden');
  document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === 'home'));
  renderWorkspace();
  newThread(activeProduct, { persist: true });
  setComposerMode('customer');
  if (!startDialogue(activeProduct)) resetToStaticExample();
  renderPhoneState();
  showToast(`${activeProduct.name} est maintenant le produit testé dans la conversation.`);
}

function openCatalog() {
  document.querySelector('#home-view').classList.add('hidden');
  document.querySelector('#catalog-view').classList.remove('hidden');
  document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === 'catalog'));
}

function openPromotion() {
  const select = document.querySelector('#promotion-product');
  select.innerHTML = products.length ? products.map(product => `<option value="${product.id}">${esc(product.name)} — ${money(product.price)}</option>`).join('') : '<option>Aucun article dans le catalogue</option>';
  if (!products.length) { showToast('Ajoutez d’abord un article à votre catalogue.'); return; }
  document.querySelector('#promotion-result').textContent = 'Le message créé apparaîtra ici.';
  document.querySelector('#promotion-modal').showModal();
}

// Options « cette photo montre … » : les couleurs/teintes saisies dans le formulaire, rafraîchies
// à chaque frappe pour que la vendeuse puisse rattacher une photo à une couleur précise.
function refreshVariantOptions(selected = []) {
  const category = document.querySelector('#product-category').value;
  const sourceId = category === 'Cosmétiques' ? '#cosmetics-shade-values' : category === 'Accessoires' ? '#accessories-color-values' : '#clothes-color-values';
  const values = document.querySelector(sourceId).value.split(',').map(v => v.trim()).filter(Boolean);
  ['1','2','3'].forEach((n, index) => {
    const select = document.querySelector(`#product-photo-variant-${n}`);
    const current = selected[index] !== undefined ? selected[index] : select.value;
    select.innerHTML = `<option value="">toutes les couleurs</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value = values.includes(current) ? current : '';
  });
}
['#clothes-color-values', '#cosmetics-shade-values', '#accessories-color-values', '#product-category'].forEach(id => document.querySelector(id).addEventListener('input', () => refreshVariantOptions()));

// Réinitialise les 4 aperçus média du formulaire produit (3 photos + vidéo) à leur état vide.
function resetMediaPreviews() {
  ['1','2','3'].forEach(n => document.querySelector(`#photo-preview-${n}`).textContent = 'Aucune photo sélectionnée');
  document.querySelector('#video-preview').textContent = 'Aucune vidéo sélectionnée';
}

// Lit un fichier en dataURL sous forme de Promise, pour paralléliser la lecture des 3 photos +
// 1 vidéo du formulaire produit avec Promise.all plutôt que d'imbriquer des callbacks FileReader.
// Renvoie null si aucun fichier n'est passé (emplacement laissé vide par la vendeuse).
function readFileAsDataURL(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Options avancées : repliées pour un nouvel article, dépliées à la modification si elles contiennent quelque chose.
function setAdvancedOpen(open) { document.querySelectorAll('#product-modal details.advanced').forEach(details => { details.open = open; }); }
function openAdvancedIfFilled() { document.querySelectorAll('#product-modal details.advanced').forEach(details => { details.open = [...details.querySelectorAll('input, select')].some(field => field.type === 'checkbox' ? field.checked : field.type === 'file' ? false : field.value && field.value !== '0') || Boolean(details.querySelector('.image-preview img, .image-preview video')); }); }
function openAdd() { form.reset(); setAdvancedOpen(false); document.querySelector('#product-id').value = ''; document.querySelector('#form-title').textContent = 'Ajouter un article'; resetMediaPreviews(); renderCategorySelect(); updateSizeTypePlaceholder(); updateDimensionTypePlaceholder(); refreshVariantOptions(['', '', '']); modal.showModal(); }
function openEdit(id) {
  const product = products.find(item => item.id === id); if (!product) return;
  document.querySelector('#product-id').value = product.id;
  document.querySelector('#product-name').value = product.name;
  document.querySelector('#product-price').value = product.price;
  document.querySelector('#product-stock').value = product.stock;
  if (product.category === 'Vêtements') {
    document.querySelector('#clothes-size-type').value = product.size.sizeType;
    document.querySelector('#clothes-size-mode').value = product.size.mode;
    document.querySelector('#clothes-size-values').value = product.size.values.join(', ');
    updateSizeTypePlaceholder();
    document.querySelector('#clothes-color-mode').value = product.color.mode;
    document.querySelector('#clothes-color-values').value = product.color.values.join(', ');
    document.querySelector('#clothes-material').value = product.material;
    document.querySelector('#clothes-gender').value = product.gender;
    document.querySelector('#clothes-set-content').value = product.setContent;
    document.querySelector('#clothes-range-name').value = product.rangeName;
  }
  if (product.category === 'Cosmétiques') {
    const writeChoice = (choice, activeId, fieldsId, modeId, valuesId) => {
      document.querySelector(activeId).checked = choice.active;
      document.querySelector(fieldsId).classList.toggle('hidden', !choice.active);
      document.querySelector(modeId).value = choice.mode;
      document.querySelector(valuesId).value = choice.values.join(', ');
    };
    document.querySelector('#cosmetics-product-type').value = product.productType;
    writeChoice(product.shade, '#cosmetics-shade-active', '#cosmetics-shade-fields', '#cosmetics-shade-mode', '#cosmetics-shade-values');
    writeChoice(product.volume, '#cosmetics-volume-active', '#cosmetics-volume-fields', '#cosmetics-volume-mode', '#cosmetics-volume-values');
    writeChoice(product.length, '#cosmetics-length-active', '#cosmetics-length-fields', '#cosmetics-length-mode', '#cosmetics-length-values');
    writeChoice(product.texture, '#cosmetics-texture-active', '#cosmetics-texture-fields', '#cosmetics-texture-mode', '#cosmetics-texture-values');
    document.querySelector('#cosmetics-expiry-active').checked = !!product.expiryDate;
    document.querySelector('#cosmetics-expiry-date').classList.toggle('hidden', !product.expiryDate);
    document.querySelector('#cosmetics-expiry-date').value = product.expiryDate;
    document.querySelector('#cosmetics-box-content').value = product.boxContent;
    document.querySelector('#cosmetics-range-name').value = product.rangeName;
  }
  if (product.category === 'Accessoires') {
    document.querySelector('#accessories-item-type').value = product.itemType;
    document.querySelector('#accessories-color-mode').value = product.color.mode;
    document.querySelector('#accessories-color-values').value = product.color.values.join(', ');
    document.querySelector('#accessories-material').value = product.material;
    document.querySelector('#accessories-dimension-active').checked = product.dimension.active;
    document.querySelector('#accessories-dimension-fields').classList.toggle('hidden', !product.dimension.active);
    document.querySelector('#accessories-dimension-type').value = product.dimension.dimensionType;
    document.querySelector('#accessories-dimension-mode').value = product.dimension.mode;
    document.querySelector('#accessories-dimension-values').value = product.dimension.values.join(', ');
    updateDimensionTypePlaceholder();
    document.querySelector('#accessories-pack-content').value = product.packContent;
    document.querySelector('#accessories-range-name').value = product.rangeName;
  }
  renderCategorySelect(product.category);
  resetMediaPreviews();
  product.media.photos.forEach((photo, index) => { document.querySelector(`#photo-preview-${index + 1}`).innerHTML = `<img src="${photo}" alt="Aperçu">`; });
  document.querySelector('#product-worn-count').value = String(product.media.wornCount);
  refreshVariantOptions(product.media.variants || []);
  setTimeout(openAdvancedIfFilled, 0);
  if (product.media.video) document.querySelector('#video-preview').textContent = 'Vidéo déjà enregistrée pour cet article';
  document.querySelector('#form-title').textContent = 'Modifier l’article'; modal.showModal();
}
function removeProduct(id) {
  products = products.filter(product => product.id !== id); save(productKey, products); activeProduct = products[0] || null; renderProducts(); showToast('Article supprimé du catalogue.');
}

async function submitProduct() {
  const id = document.querySelector('#product-id').value || `p${Date.now()}`;
  const old = products.find(product => product.id === id);
  const category = document.querySelector('#product-category').value;
  const style = category === 'Cosmétiques' ? 'care' : category === 'Accessoires' ? 'bag' : 'dress';
  const base = { id, name:document.querySelector('#product-name').value.trim(), price:Number(document.querySelector('#product-price').value), stock:Number(document.querySelector('#product-stock').value), category, style };
  const toValues = (text) => text.split(',').map(v => v.trim()).filter(Boolean);
  const readChoice = (activeId, modeId, valuesId) => { const active = document.querySelector(activeId).checked; return { active, mode: document.querySelector(modeId).value, values: active ? toValues(document.querySelector(valuesId).value) : [''] }; };
  const product = category === 'Vêtements'
    ? { ...base,
        size: { sizeType: document.querySelector('#clothes-size-type').value, mode: document.querySelector('#clothes-size-mode').value, values: toValues(document.querySelector('#clothes-size-values').value) },
        color: { mode: document.querySelector('#clothes-color-mode').value, values: toValues(document.querySelector('#clothes-color-values').value) },
        material: document.querySelector('#clothes-material').value.trim(),
        gender: document.querySelector('#clothes-gender').value.trim(),
        setContent: document.querySelector('#clothes-set-content').value.trim(),
        rangeName: document.querySelector('#clothes-range-name').value.trim() }
    : category === 'Cosmétiques'
    ? { ...base,
        productType: document.querySelector('#cosmetics-product-type').value.trim(),
        shade: readChoice('#cosmetics-shade-active', '#cosmetics-shade-mode', '#cosmetics-shade-values'),
        volume: readChoice('#cosmetics-volume-active', '#cosmetics-volume-mode', '#cosmetics-volume-values'),
        length: readChoice('#cosmetics-length-active', '#cosmetics-length-mode', '#cosmetics-length-values'),
        texture: readChoice('#cosmetics-texture-active', '#cosmetics-texture-mode', '#cosmetics-texture-values'),
        expiryDate: document.querySelector('#cosmetics-expiry-active').checked ? document.querySelector('#cosmetics-expiry-date').value : '',
        boxContent: document.querySelector('#cosmetics-box-content').value.trim(),
        rangeName: document.querySelector('#cosmetics-range-name').value.trim() }
    : category === 'Accessoires'
    ? { ...base,
        itemType: document.querySelector('#accessories-item-type').value.trim(),
        color: { mode: document.querySelector('#accessories-color-mode').value, values: toValues(document.querySelector('#accessories-color-values').value) },
        material: document.querySelector('#accessories-material').value.trim(),
        dimension: { dimensionType: document.querySelector('#accessories-dimension-type').value, ...readChoice('#accessories-dimension-active', '#accessories-dimension-mode', '#accessories-dimension-values') },
        packContent: document.querySelector('#accessories-pack-content').value.trim(),
        rangeName: document.querySelector('#accessories-range-name').value.trim() }
    : { ...base, sizes: old?.sizes || '', colors: old?.colors || '' };
  // Lit les 3 emplacements photo + la vidéo en parallèle. Un emplacement laissé vide (pas de
  // nouveau fichier choisi) retombe sur le média déjà enregistré pour ce produit en édition,
  // pour ne jamais effacer une photo existante que la vendeuse n'a pas touchée.
  const photoFiles = ['1','2','3'].map(n => document.querySelector(`#product-photo-${n}`).files[0]);
  const videoFile = document.querySelector('#product-video-file').files[0];
  const [newPhotos, newVideo] = await Promise.all([
    Promise.all(photoFiles.map(readFileAsDataURL)),
    readFileAsDataURL(videoFile)
  ]);
  const oldPhotos = old?.media.photos || [];
  const slots = newPhotos.map((photo, index) => ({ photo: photo || oldPhotos[index], variant: document.querySelector(`#product-photo-variant-${index + 1}`).value })).filter(slot => slot.photo);
  const photos = slots.map(slot => slot.photo);
  const variants = slots.map(slot => slot.variant);
  const requestedWornCount = Number(document.querySelector('#product-worn-count').value);
  product.media = {
    photos,
    variants,
    wornCount: Math.min(requestedWornCount, photos.length),
    video: newVideo || old?.media.video || ''
  };
  if (old) products = products.map(item => item.id === id ? product : item); else products.push(product);
  save(productKey, products); activeProduct = product; activeCategory = product.category; renderWorkspace(); modal.close(); showToast('Article enregistré : Ọjà peut maintenant le présenter aux clients.');
  // Premier article d'une boutique vide : le téléphone quitte son état vide et démarre une conversation.
  if (!activeThread) { newThread(activeProduct, { persist: true }); setComposerMode('customer'); startDialogue(activeProduct); renderPhoneState(); }
}

// Primitives du chat : chaque message est rendu ET enregistré dans le fil actif (conversations.js).
function addReply(text) { pushMessage('oja', 'text', text); }
function addIncoming(text) { pushMessage('customer', 'text', text); }

// Visionneuse plein écran pour les photos du chat (produit, portée, ou envoyée par la cliente).
// Volontairement limitée aux <img> : les bulles vidéo gardent leurs contrôles natifs <video
// controls> (lecture/pause/plein écran déjà gérés par le navigateur), donc pas de zoom dessus.
let mediaViewerList = [];
let mediaViewerIndex = 0;

// Reconstruit la liste des photos zoomables à chaque ouverture plutôt que de la tenir à jour en
// continu : plus simple, et toujours exacte puisque le chat grandit au fil de la conversation.
function openMediaViewer(clickedImg) {
  mediaViewerList = Array.from(document.querySelectorAll('#chat img.zoomable'));
  mediaViewerIndex = mediaViewerList.indexOf(clickedImg);
  renderMediaViewer();
  document.querySelector('#media-viewer').showModal();
}

function renderMediaViewer() {
  const total = mediaViewerList.length;
  document.querySelector('#media-viewer-image').src = mediaViewerList[mediaViewerIndex].src;
  document.querySelector('#media-viewer-count').textContent = total > 1 ? `${mediaViewerIndex + 1} / ${total}` : '';
  document.querySelector('#media-viewer-prev').classList.toggle('hidden', total <= 1);
  document.querySelector('#media-viewer-next').classList.toggle('hidden', total <= 1);
}

function showPrevMedia() { mediaViewerIndex = (mediaViewerIndex - 1 + mediaViewerList.length) % mediaViewerList.length; renderMediaViewer(); }
function showNextMedia() { mediaViewerIndex = (mediaViewerIndex + 1) % mediaViewerList.length; renderMediaViewer(); }
// Envoie une image dans le chat (dataURL). Même structure que addReply/addIncoming, avec une
// classe .bubble-image en plus pour un habillage visuel dédié (bords arrondis, pas de fond coloré).
function addImageReply(dataUrl) { pushMessage('oja', 'image', dataUrl); }
function addImageIncoming(dataUrl) { pushMessage('customer', 'image', dataUrl); }
// Envoie une courte vidéo dans le chat (dataURL). Même habillage que .bubble-image (pas de fond
// coloré, coins arrondis) ; controls natifs du navigateur pour lecture/pause dans le simulateur.
function addVideoReply(dataUrl) { pushMessage('oja', 'video', dataUrl); }
// Boutons de choix rapides. Mémorisés dans le fil actif pour être reproposés à sa réouverture.
function setChoices(items, { record = true } = {}) {
  suggestions.innerHTML = items.map(item => `<button data-choice="${esc(item.id)}">${esc(item.label)}</button>`).join('');
  document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => handleChoice(button.dataset.choice)));
  if (record && activeThread) { activeThread.lastChoices = items; touchThread(); }
}

// Sépare les photos d'un produit entre "produit" (les premières uploadées) et "portées" (les
// wornCount DERNIÈRES uploadées, par convention). wornCount = 0 → tout est classé "produit".
function splitProductPhotos(media) {
  const cut = media.photos.length - media.wornCount;
  return { productPhotos: media.photos.slice(0, cut), wornPhotos: media.photos.slice(cut) };
}

// Escalade vers la vendeuse : utilisée quand le moteur ne reconnaît pas le message, ou quand une
// règle a explicitement choisi de transférer (ex. paiement échelonné, non tranché côté boutique).
// La cliente reçoit un message honnête et rassurant (sauf `silent`, quand le message précédent
// l'a déjà dit) ; la vendeuse reçoit une alerte cliquable sur l'Accueil.
function escalateToShop(message, product, { silent = false } = {}) {
  // Pas de doublon : si la réponse précédente annonce déjà le transfert (« je transmets… »,
  // « je préviens… »), on ne répète pas la formule, on crée seulement l'alerte.
  const lastBubble = chat.querySelector('.bubble.outgoing:last-of-type');
  const alreadyAnnounced = lastBubble && /transmets|préviens|je vérifie|je demande/i.test(lastBubble.textContent);
  if (!silent && !alreadyAnnounced) addReply(`Je transmets ça à ${shopName()}, elle vous répond très vite 🌷`);
  escalations.unshift({
    id: `e${Date.now()}`,
    productId: product ? product.id : null,
    productName: product ? product.name : 'Conversation',
    customerName: currentCustomerName() || 'Nouvelle cliente',
    threadId: activeThread ? activeThread.id : null,
    message,
    date: new Date().toISOString()
  });
  save(escalationKey, escalations);
  onEscalated();
  playNotification();
  renderWorkspace();
}

// Boutons de choix rapides du simulateur. Tout passe par le moteur (dialogue.js) ; seuls les
// deux boutons de l'exemple statique de démarrage (« Confirmer la taille M », « Prendre la
// commande ») sont traités ici : ils reprennent la conversation en cours avec la taille M déjà
// choisie, sans réafficher l'accueil.
function handleChoice(choice) {
  if (!activeProduct) return showToast('Ajoutez un article avant de simuler une commande.');
  if (choice === 'size' || choice === 'order') {
    addReply(`Parfait ✨ ${esc(activeProduct.name)} est disponible.`);
    if (!resumeDialogue(activeProduct, { size: 'M' })) resetToStaticExample();
    return;
  }
  if (dialogue.product !== activeProduct) resumeDialogueSilently(activeProduct);
  if (!handleDialogueChoice(choice)) showToast('Choix non reconnu.');
}

function setTheme(theme) { const dark = theme === 'dark'; document.body.classList.toggle('dark-mode', dark); themeToggle.textContent = dark ? '☀' : '☾'; themeToggle.setAttribute('aria-label', dark ? 'Activer le mode clair' : 'Activer le mode nuit'); localStorage.setItem('oja-theme', theme); }

document.querySelectorAll('[data-action="Ajouter un produit"]').forEach(button => button.addEventListener('click', openAdd));
document.querySelectorAll('[data-action="catalog"]').forEach(button => button.addEventListener('click', openCatalog));
document.querySelectorAll('[data-action="promotion"]').forEach(button => button.addEventListener('click', openPromotion));
document.querySelectorAll('[data-action="categories"]').forEach(button => button.addEventListener('click', openCategories));
document.querySelectorAll('[data-action="Voir le guide"]').forEach(button => button.addEventListener('click', () => showToast('Le guide vendeuse arrivera avec la connexion WhatsApp.')));
document.querySelectorAll('[data-action="edit-rules"]').forEach(button => button.addEventListener('click', openProfile));
document.querySelector('#product-category').addEventListener('change', event => toggleCategoryFields(event.target.value));
document.querySelector('#clothes-size-type').addEventListener('change', updateSizeTypePlaceholder);
document.querySelector('#accessories-dimension-type').addEventListener('change', updateDimensionTypePlaceholder);
document.querySelector('#cosmetics-shade-active').addEventListener('change', event => document.querySelector('#cosmetics-shade-fields').classList.toggle('hidden', !event.target.checked));
document.querySelector('#cosmetics-volume-active').addEventListener('change', event => document.querySelector('#cosmetics-volume-fields').classList.toggle('hidden', !event.target.checked));
document.querySelector('#cosmetics-length-active').addEventListener('change', event => document.querySelector('#cosmetics-length-fields').classList.toggle('hidden', !event.target.checked));
document.querySelector('#cosmetics-texture-active').addEventListener('change', event => document.querySelector('#cosmetics-texture-fields').classList.toggle('hidden', !event.target.checked));
document.querySelector('#cosmetics-expiry-active').addEventListener('change', event => document.querySelector('#cosmetics-expiry-date').classList.toggle('hidden', !event.target.checked));
document.querySelector('#accessories-dimension-active').addEventListener('change', event => document.querySelector('#accessories-dimension-fields').classList.toggle('hidden', !event.target.checked));
document.querySelector('#composer').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#composer-input');
  const message = input.value.trim();
  if (!message) return;
  if (!activeProduct) { showToast('Ajoutez un article avant de simuler une commande.'); return; }
  input.value = '';
  if (composerMode === 'seller') { sellerReply(message); return; }
  addIncoming(esc(message));
  // Josie a repris ce fil : la cliente écrit, mais Ọjà reste en pause.
  if (activeThread && activeThread.status === 'seller') { activeThread.unread += 1; touchThread(); return; }
  // Le moteur doit connaître le produit en cours : si l'exemple statique de démarrage est encore
  // affiché (aucune conversation lancée), on l'attache au produit actif sans réafficher l'accueil.
  if (dialogue.product !== activeProduct) resumeDialogueSilently(activeProduct);
  handleFreeText(message);
});
// Le client envoie une photo depuis le simulateur : Ọjà ne peut pas analyser une image (pas de
// vraie IA dans ce prototype), donc toute photo reçue escalade automatiquement vers Josie —
// même logique que les mots-clés non reconnus, avec un aperçu dédié ("📷 Photo envoyée") sur
// l'alerte Accueil plutôt que le texte du message, absent ici.
document.querySelector('#composer-image').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  if (!activeProduct) { showToast('Ajoutez un article avant de simuler une commande.'); event.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    addImageIncoming(reader.result);
    if (activeThread && activeThread.status === 'seller') { activeThread.unread += 1; touchThread(); return; }
    escalateToShop('📷 Photo envoyée', activeProduct);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
});
// Bascule entre les 4 vues (Accueil/Commandes/Catalogue/Clients) en masquant toutes les autres.
// Chaque vue peut avoir un rendu à déclencher à l'ouverture, pour être sûr d'afficher des données à jour.
const VIEW_CONTAINERS = { home:'#home-view', conversations:'#conversations-view', orders:'#orders-view', catalog:'#catalog-view', customers:'#customers-view' };
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.view;
  Object.entries(VIEW_CONTAINERS).forEach(([view, selector]) => document.querySelector(selector).classList.toggle('hidden', view !== target));
  document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === target));
  if (target === 'orders') renderOrdersView();
  if (target === 'customers') renderCustomersView();
  if (target === 'conversations') renderConversationsView();
}));

// Nav du bas mobile : binding volontairement séparé du binding [data-view] desktop ci-dessus,
// avec son propre attribut [data-mobile-view]. Une seule liste fusionnée aurait obligé le
// mécanisme desktop à connaître .phone-zone (la 5e vue "Conversations"), et donc à gérer son
// .hidden même au-dessus du seuil mobile — or .hidden est !important (voir styles.css), donc le
// neutraliser en CSS desktop aurait demandé un !important encore plus spécifique, fragile. En
// séparant les deux bindings, .phone-zone ne reçoit jamais de .hidden posé par du JS desktop :
// sur desktop elle reste simplement visible en permanence, comme avant ce chantier.
// Sur mobile, l'onglet Conversations montre la liste des fils ET le téléphone (le fil ouvert).
const MOBILE_VIEW_CONTAINERS = { ...VIEW_CONTAINERS, phone:'.phone-zone' };
document.querySelectorAll('[data-mobile-view]').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.mobileView;
  Object.entries(MOBILE_VIEW_CONTAINERS).forEach(([view, selector]) => document.querySelector(selector).classList.toggle('hidden', !(view === target || (target === 'conversations' && view === 'phone'))));
  if (target === 'conversations') renderConversationsView();
  document.querySelectorAll('.mobile-nav-item[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === target));
  if (target === 'orders') renderOrdersView();
  if (target === 'customers') renderCustomersView();
}));

// Petit menu profil mobile (avatar en haut de l'Accueil -> Infos boutique / Réglages), même
// principe que l'écran Profil à 3 entrées de la maquette d'origine, ramené à 2 puisque le
// Registre de langue n'existe pas encore comme écran séparé dans le vrai code.
document.querySelector('#mobile-profile-avatar').addEventListener('click', () => document.querySelector('#mobile-profile-menu').classList.toggle('hidden'));
document.querySelector('#mobile-profile-open-info').addEventListener('click', () => { document.querySelector('#mobile-profile-menu').classList.add('hidden'); openProfile(); });
document.querySelector('#mobile-profile-open-language').addEventListener('click', () => { document.querySelector('#mobile-profile-menu').classList.add('hidden'); showToast('Le registre de langue de Ọjà n\'est pas encore configuré.'); });
document.querySelector('#mobile-profile-open-settings').addEventListener('click', () => { document.querySelector('#mobile-profile-menu').classList.add('hidden'); openSettings(); });
document.addEventListener('click', event => {
  const menu = document.querySelector('#mobile-profile-menu');
  if (!menu.classList.contains('hidden') && !event.target.closest('.mobile-profile')) menu.classList.add('hidden');
});

document.querySelector('.close-modal').addEventListener('click', () => modal.close());
document.querySelector('.cancel-button').addEventListener('click', () => modal.close());
['1','2','3'].forEach(n => document.querySelector(`#product-photo-${n}`).addEventListener('change', event => {
  const file = event.target.files[0];
  const el = document.querySelector(`#photo-preview-${n}`);
  if (!file) { el.textContent = 'Aucune photo sélectionnée'; return; }
  readFileAsDataURL(file).then(dataUrl => { el.innerHTML = `<img src="${dataUrl}" alt="Aperçu">`; });
}));
document.querySelector('#product-video-file').addEventListener('change', event => {
  const file = event.target.files[0];
  document.querySelector('#video-preview').textContent = file ? `Vidéo sélectionnée : ${file.name}` : 'Aucune vidéo sélectionnée';
});
form.addEventListener('submit', event => { event.preventDefault(); submitProduct(); });
document.querySelector('.close-promotion').addEventListener('click', () => document.querySelector('#promotion-modal').close());
document.querySelector('.cancel-promotion').addEventListener('click', () => document.querySelector('#promotion-modal').close());
document.querySelector('#promotion-form').addEventListener('submit', event => { event.preventDefault(); const product = products.find(item => item.id === document.querySelector('#promotion-product').value); const percent = Number(document.querySelector('#promotion-percent').value); const reduced = Math.round(product.price * (1 - percent / 100)); const message = `${document.querySelector('#promotion-message').value.trim()}\n\n${product.name} : ${money(product.price)} → ${money(reduced)} (-${percent} %) ✨`; document.querySelector('#promotion-result').textContent = message; showToast('Message promotionnel créé.'); });
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { const category = button.dataset.category; categories = categories.includes(category) ? categories.filter(item => item !== category) : [...categories, category]; renderCategoryChoices(); }));
// Charge les trois articles d'exemple (et deux commandes) pour découvrir Ọjà sans rien saisir.
function loadDemoData() {
  const demoProducts = defaults.map(product => migrateProduct({ ...product }));
  const existing = new Set(products.map(product => product.id));
  products = [...products, ...demoProducts.filter(product => !existing.has(product.id))];
  if (!orders.length) orders = defaultOrders.map(order => migrateOrder({ ...order }, []));
  save(productKey, products); save(orderKey, orders);
  activeProduct = products.find(product => product.category === activeCategory) || products[0];
  renderWorkspace(); renderProducts(); startDemoThread();
}
function finishOnboarding(message) {
  document.querySelector('#onboarding').classList.add('hidden');
  renderWorkspace();
  if (message) showToast(message);
}
document.querySelector('#continue-button').addEventListener('click', () => {
  save('oja-categories', categories);
  activeCategory = categories.includes(activeCategory) ? activeCategory : categories[0];
  if (products.length) { finishOnboarding('Catégories enregistrées. Vous pourrez les modifier à tout moment.'); return; }
  document.querySelector('#onboarding-step-1').classList.add('hidden');
  document.querySelector('#onboarding-step-2').classList.remove('hidden');
});
document.querySelector('#onboarding-add-product').addEventListener('click', () => { finishOnboarding(); openAdd(); });
document.querySelector('#load-demo-button').addEventListener('click', () => { loadDemoData(); finishOnboarding('Trois articles d\'exemple chargés. Remplacez-les par les vôtres quand vous voulez.'); });
document.querySelector('#onboarding-later').addEventListener('click', () => finishOnboarding('Vous pourrez ajouter un article à tout moment depuis le Catalogue.'));
setTheme(localStorage.getItem('oja-theme') || 'light'); themeToggle.addEventListener('click', () => setTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark'));
// Délégation sur #chat plutôt qu'un listener par <img> : couvre aussi les photos ajoutées
// dynamiquement en cours de conversation (addImageReply/addImageIncoming), pas seulement
// celles présentes au chargement initial de la page.
chat.addEventListener('click', event => { if (event.target.matches('img.zoomable')) openMediaViewer(event.target); });
document.querySelector('#media-viewer-close').addEventListener('click', () => document.querySelector('#media-viewer').close());
document.querySelector('#media-viewer-prev').addEventListener('click', showPrevMedia);
document.querySelector('#media-viewer-next').addEventListener('click', showNextMedia);
// event.target === viewer signifie que le clic est tombé sur le <dialog> lui-même (le fond),
// pas sur l'image ni un bouton (qui auraient chacun leur propre target plus précis).
document.querySelector('#media-viewer').addEventListener('click', event => {
  if (event.target === document.querySelector('#media-viewer')) document.querySelector('#media-viewer').close();
});
document.addEventListener('keydown', event => {
  if (!document.querySelector('#media-viewer').open) return;
  if (event.key === 'ArrowLeft') showPrevMedia();
  if (event.key === 'ArrowRight') showNextMedia();
});
document.querySelectorAll('[data-composer-mode]').forEach(button => button.addEventListener('click', () => { setComposerMode(button.dataset.composerMode); document.querySelector('#composer-input').focus(); }));
document.querySelector('#resume-oja').addEventListener('click', resumeOja);
initConversations(); renderWorkspace(); renderCategoryChoices(); renderProfile(); renderHomeDate(); startDemoThread(); renderConversationsView(); if (categories.length) document.querySelector('#onboarding').classList.add('hidden');
renderAssistantBadge(); warmUpAssistant();
