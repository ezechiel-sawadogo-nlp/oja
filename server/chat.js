#!/usr/bin/env node
// =====================================================================================
// server/chat.js — Parler à Ọjà dans le terminal, avec les vraies données de la boutique
//
//   node server/chat.js                       (utilise server/data/oja-state.json)
//   node server/chat.js --data /chemin/oja-state.json --product sac
//
// Tape un message comme une cliente, ou le numéro d'un bouton. « /quit » pour sortir.
// Les commandes et alertes créées sont enregistrées dans le fichier de données, comme si
// elles venaient du simulateur ou, demain, de WhatsApp.
// =====================================================================================
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createSession } = require('./engine');

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const DATA_FILE = path.resolve(arg('--data', process.env.OJA_DATA || path.join(__dirname, 'data', 'oja-state.json')));

let file; try { file = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { file = { version: 0, data: {} }; }
const state = file.data;
if (!state['oja-products'] || !state['oja-products'].length) { console.error(`Aucun produit dans ${DATA_FILE}. Ajoutez-en depuis l'interface (node server/server.js) d'abord.`); process.exit(1); }
const persist = () => { file.version = (file.version || 0) + 1; fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(file)); };

const productId = arg('--product', state['oja-products'][0].id);
const session = createSession(state, { productId, onSave: persist });
let choices = [];
const strip = html => html.replace(/<br\s*\/?>/g, '\n        ').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function show(result) {
  result.replies.forEach(reply => console.log(`  Ọjà : ${strip(reply)}`));
  result.images.forEach(() => console.log('  Ọjà : [photo]'));
  result.escalations.forEach(e => console.log(`  ⚠ alerte pour la boutique : « ${e.message} »`));
  choices = result.choices;
  if (choices.length) console.log(`  ${choices.map((c, i) => `[${i + 1}] ${c.label}`).join('  ')}`);
}

console.log(`Ọjà — conversation de test (${state['oja-products'].find(p => p.id === productId).name}). « /quit » pour sortir.\n`);
show(session.start());
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'cliente > ' });
rl.prompt();
rl.on('line', line => {
  const text = line.trim();
  if (!text) return rl.prompt();
  if (text === '/quit') return rl.close();
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= choices.length) show(session.choose(choices[number - 1].id));
  else show(session.send(text));
  rl.prompt();
});
rl.on('close', () => { console.log('\nAu revoir.'); process.exit(0); });
