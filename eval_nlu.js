// Évaluation du NLU (nlu.js) sur le corpus de phrases de clientes.
//   node eval_nlu.js            -> exactitude globale, par intention, et liste des erreurs
// Une phrase est « correcte » si l'intention forte de score maximal (hors intentions faibles
// si une forte existe) est celle attendue, ou si aucune intention n'est détectée pour "none".
// Les entités attendues (couleurs, tailles, quantité, paiement) sont vérifiées si présentes.
const fs = require('fs');
const vm = require('vm');
const NLU = vm.runInContext(fs.readFileSync(__dirname + '/nlu.js', 'utf8') + ';NLU', vm.createContext({ console }));
const WEAK = new Set(['greeting', 'info', 'thanks', 'affirmative', 'negative']);
// --file corpus/test_inedit.jsonl : évaluer un autre jeu (par défaut, le corpus de non-régression).
const fileArg = process.argv.indexOf('--file');
const corpusFile = fileArg >= 0 ? process.argv[fileArg + 1] : __dirname + '/corpus/corpus_clientes.jsonl';
const lines = fs.readFileSync(corpusFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

function predict(text) {
  const analysis = NLU.analyze(text);
  const strong = analysis.intents.filter(i => !WEAK.has(i.id));
  const weak = analysis.intents.filter(i => WEAK.has(i.id));
  // Même heuristique que dialogue.js : entités couleur/taille sans mot-clé -> intention couleur/taille.
  const advice = strong.some(i => i.id === 'advice');
  if (!advice && !strong.some(i => i.id === 'color') && analysis.entities.colors.length) strong.push({ id: 'color', score: 1, priority: 2 });
  if (!advice && !strong.some(i => ['size', 'price', 'delivery', 'installment'].includes(i.id)) && analysis.entities.sizes.length) strong.push({ id: 'size', score: 1, priority: 3 });
  strong.sort((a, b) => b.score - a.score || a.priority - b.priority);
  const top = strong[0] || weak[0];
  return { intent: top ? top.id : 'none', entities: analysis.entities, all: analysis.intents.map(i => `${i.id}:${i.score}`).join(' ') };
}

let ok = 0; const perIntent = {}; const errors = [];
for (const sample of lines) {
  const pred = predict(sample.text);
  let good = pred.intent === sample.intent;
  const entityErrors = [];
  if (sample.entities) {
    for (const [key, expected] of Object.entries(sample.entities)) {
      const got = pred.entities[key];
      const match = Array.isArray(expected) ? expected.every(v => (got || []).includes(v)) : got === expected;
      if (!match) entityErrors.push(`${key}: attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(got)}`);
    }
  }
  if (entityErrors.length) good = false;
  perIntent[sample.intent] = perIntent[sample.intent] || { total: 0, ok: 0 };
  perIntent[sample.intent].total += 1;
  if (good) { ok += 1; perIntent[sample.intent].ok += 1; } else errors.push({ text: sample.text, expected: sample.intent, got: pred.intent, detail: pred.all, entityErrors });
}
console.log(`Exactitude : ${ok}/${lines.length} (${(100 * ok / lines.length).toFixed(1)} %)\n`);
console.log('Par intention :');
Object.entries(perIntent).sort().forEach(([intent, s]) => console.log(`  ${intent.padEnd(12)} ${s.ok}/${s.total}`));
if (errors.length) {
  console.log('\nErreurs :');
  errors.forEach(e => console.log(`  « ${e.text} » attendu=${e.expected} obtenu=${e.got} [${e.detail}]${e.entityErrors.length ? ' ' + e.entityErrors.join(' ; ') : ''}`));
}
process.exit(errors.length && process.argv.includes('--strict') ? 1 : 0);
