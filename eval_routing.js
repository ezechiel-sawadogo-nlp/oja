// Évaluation du routage de bout en bout : pour chaque message, qui répond ?
//   règles     -> Ọjà répond seul, depuis les données de la boutique
//   assistant  -> confié au modèle local (question de conseil, ou message que les règles ne comprennent pas)
//   vendeuse   -> transfert direct (négociation, demande d'humain, information absente des données)
//
//   node eval_routing.js                                   -> jeu inédit (corpus/test_inedit.jsonl)
//   node eval_routing.js --file corpus/corpus_clientes.jsonl
//
// Chaque message est envoyé dans une conversation neuve sur la robe (moteur réel : nlu.js +
// dialogue.js via server/engine.js), boutique au profil complet. Le modèle de langue n'est pas
// appelé : on mesure seulement la décision de routage, pas la qualité de ses réponses.
const fs = require('fs');
const path = require('path');
const { createSession } = require('./server/engine');

const fileArg = process.argv.indexOf('--file');
const file = fileArg >= 0 ? process.argv[fileArg + 1] : path.join(__dirname, 'corpus', 'test_inedit.jsonl');
const samples = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

const MEDIA = { photos: [], wornCount: 0, video: '', variants: [] };
function shop() {
  return {
    'oja-products': [
      { id: 'robe', name: 'Robe satin beige', price: 18500, stock: 3, category: 'Vêtements', media: MEDIA, size: { sizeType: 'Standard', mode: 'plusieurs', values: ['S', 'M', 'L'] }, color: { mode: 'plusieurs', values: ['Beige', 'Noir'] }, material: 'Satin', gender: '', setContent: '', rangeName: '' },
      { id: 'sac', name: 'Sac à main Lune', price: 17000, stock: 2, category: 'Accessoires', media: MEDIA, itemType: 'Sac à main', color: { mode: 'plusieurs', values: ['Noir', 'Bordeaux'] }, material: 'Cuir', dimension: { active: false, dimensionType: 'Format', mode: 'unique', values: [''] }, packContent: '', rangeName: '' }
    ],
    'oja-profile': { shopName: 'Josie Style', hours: '8h - 20h, du lundi au samedi', deliveryZone: 'Ouagadougou', deliveryFee: '1000', deliveryDelay: '24 h', installmentMin: '20000', installmentPercent: '50' }
  };
}

function route(text) {
  let fallback = null;
  const session = createSession(shop(), { productId: 'robe', onFallback: (message, options) => { fallback = options.advice ? 'conseil' : 'incompris'; } });
  session.start();
  const result = session.send(text);
  if (result.escalations.length) return { route: 'vendeuse', replies: result.replies };
  if (fallback) return { route: 'assistant', why: fallback, replies: result.replies };
  return { route: 'regles', replies: result.replies };
}

const ROUTES = ['regles', 'assistant', 'vendeuse'];
const LABEL = { regles: 'règles', assistant: 'assistant', vendeuse: 'vendeuse' };
const confusion = Object.fromEntries(ROUTES.map(r => [r, Object.fromEntries(ROUTES.map(c => [c, 0]))]));
const counts = { regles: 0, assistant: 0, vendeuse: 0 };
const why = { conseil: 0, incompris: 0 };
const mistakes = [];
for (const sample of samples) {
  const got = route(sample.text);
  counts[got.route] += 1;
  if (got.why) why[got.why] += 1;
  if (sample.route) {
    confusion[sample.route][got.route] += 1;
    if (sample.route !== got.route) mistakes.push({ text: sample.text, expected: sample.route, got: got.route, reply: got.replies.join(' ').replace(/<[^>]+>/g, '').slice(0, 90) });
  }
}

const n = samples.length;
const pct = x => `${(100 * x / n).toFixed(0)} %`;
console.log(`${n} messages (${path.basename(file)})\n`);
console.log('Qui répond ?');
console.log(`  règles (Ọjà seul)       ${String(counts.regles).padStart(3)}  ${pct(counts.regles)}`);
console.log(`  assistant local         ${String(counts.assistant).padStart(3)}  ${pct(counts.assistant)}   (conseil : ${why.conseil}, non compris : ${why.incompris})`);
console.log(`  vendeuse (transfert)    ${String(counts.vendeuse).padStart(3)}  ${pct(counts.vendeuse)}`);
console.log(`\nSans assistant, Ọjà répond seul à ${pct(counts.regles)} des messages ; avec l'assistant activé, ${pct(counts.regles + counts.assistant)} ne vont pas directement à la vendeuse.`);

if (samples.some(s => s.route)) {
  const labelled = samples.filter(s => s.route).length;
  const agree = ROUTES.reduce((sum, r) => sum + confusion[r][r], 0);
  console.log(`\nRoutage attendu vs obtenu : ${agree}/${labelled} (${(100 * agree / labelled).toFixed(1)} %)`);
  console.log(`  attendu \\ obtenu   ${ROUTES.map(r => LABEL[r].padStart(9)).join(' ')}`);
  ROUTES.forEach(r => console.log(`  ${LABEL[r].padEnd(17)} ${ROUTES.map(c => String(confusion[r][c]).padStart(9)).join(' ')}`));
  const leaks = confusion.vendeuse.regles + confusion.vendeuse.assistant;
  console.log(`\nMessages qui devaient aller à la vendeuse mais ne lui ont pas été transférés directement : ${leaks}`);
  if (mistakes.length) {
    console.log('\nÉcarts :');
    mistakes.forEach(m => console.log(`  « ${m.text} »  attendu=${LABEL[m.expected]} obtenu=${LABEL[m.got]}  → ${m.reply}`));
  }
}
