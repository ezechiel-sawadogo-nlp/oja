// Tests du moteur sans navigateur : node server/engine.test.js
const assert = require('assert');
const { createSession } = require('./engine');
const MEDIA = { photos: [], wornCount: 0, video: '', variants: [] };
function state() {
  return {
    'oja-products': [
      { id: 'robe', name: 'Robe satin beige', price: 18500, stock: 3, category: 'Vêtements', media: MEDIA, size: { sizeType: 'Standard', mode: 'plusieurs', values: ['S', 'M', 'L'] }, color: { mode: 'plusieurs', values: ['Beige', 'Noir'] }, material: 'Satin', gender: '', setContent: '', rangeName: '' },
      { id: 'sac', name: 'Sac à main Lune', price: 17000, stock: 2, category: 'Accessoires', media: MEDIA, itemType: 'Sac à main', color: { mode: 'plusieurs', values: ['Noir', 'Bordeaux'] }, material: 'Cuir', dimension: { active: false, dimensionType: 'Format', mode: 'unique', values: [''] }, packContent: '', rangeName: '' }
    ],
    'oja-profile': { shopName: 'Boutique Awa', deliveryZone: 'Ouagadougou', deliveryFee: '1000' }
  };
}
const text = r => r.replies.join(' ').replace(/<[^>]+>/g, '');
let passed = 0;
function check(label, condition) { if (!condition) { console.log(`  FAIL ${label}`); process.exitCode = 1; } else { passed += 1; console.log(`  OK  ${label}`); } }

// 1. Flux complet avec panier, en texte libre, jusqu'à la commande
{
  const s = state(); const session = createSession(s, { productId: 'robe' });
  check('accueil + question couleur', text(session.start()).includes('Beige, Noir'));
  check('texte libre couleur', text(session.send('je prends le noir')).includes('tailles S, M, L'));
  check('texte libre taille -> nom', text(session.send('la M')).includes('votre nom'));
  check('ajout d\'un autre article', text(session.send('je veux aussi le sac Lune')).includes('Sac à main Lune'));
  check('récap panier', text(session.send('bordeaux')).replace(/\u202f/g, ' ').includes('35 500'));
  const named = session.send('je m appelle Awa Sawadogo');
  check('nom sans apostrophe', text(named).includes('Merci Awa Sawadogo'));
  check('livraison', text(session.send('à domicile')).toLowerCase().includes('payer'));
  const done = session.send('orange money');
  check('commande enregistrée', s['oja-orders'].length === 1 && s['oja-orders'][0].amount === 36500);
  check('stock décrémenté', s['oja-products'][0].stock === 2 && s['oja-products'][1].stock === 1);
  check('clôture', text(done).includes('Nous espérons vous revoir'));
}
// 2. Boutons, snapshot/restore, transfert
{
  const s = state(); const session = createSession(s, { productId: 'robe' }); session.start();
  const after = session.choose('color:Noir');
  check('bouton couleur -> question taille', text(after).includes('tailles') && after.choices.some(c => c.id === 'size:M'));
  const snap = session.snapshot();
  const resumed = createSession(s, { productId: 'robe' }); resumed.restore(snap);
  check('reprise après snapshot : la question de taille est toujours en attente', resumed.pending().type === 'attribute' && resumed.pending().keys[0] === 'size');
  check('reprise : réponse en contexte', text(resumed.send('M')).includes('votre nom'));
  const unknown = resumed.send('vous faites des retouches ?');
  check('inconnu -> transfert + alerte', text(unknown).includes('transmets') && unknown.escalations.length === 1 && s['oja-escalations'].length === 1);
}
// 5. Repli branché par l'appelant (assistant côté serveur, évaluation du routage)
{
  const calls = [];
  const session = createSession(state(), { productId: 'robe', onFallback: (message, options) => calls.push({ message, advice: Boolean(options.advice) }) });
  session.start();
  const advice = session.send('ça se lave en machine ?');
  check('onFallback : une question de conseil est confiée à l\'appelant, sans transfert', calls.length === 1 && calls[0].advice && advice.escalations.length === 0);
  session.send('vous recrutez des vendeuses ?');
  check('onFallback : un message non compris aussi (advice = false)', calls.length === 2 && !calls[1].advice);
  const human = session.send('je veux parler à la boutique');
  check('onFallback : la demande d\'humain reste un transfert direct', calls.length === 2 && human.escalations.length === 1);
}
// 6. Faux amis : ni liste des tailles, ni nouvelle commande
{
  const calls = [];
  const session = createSession(state(), { productId: 'robe', onFallback: message => calls.push(message) });
  session.start();
  const custom = session.send('vous faites des robes sur mesure ?');
  check('« sur mesure » : pas de liste des tailles, confié au repli', calls.length === 1 && !text(custom).includes('tailles'));
  const tracking = session.send("ma commande d'hier est arrivée où ?");
  check('« ma commande d\'hier » : pas de nouvelle commande, confié au repli', calls.length === 2 && !text(tracking).includes('Avec plaisir'));
}
console.log(`\n${passed} vérifications passées`);
