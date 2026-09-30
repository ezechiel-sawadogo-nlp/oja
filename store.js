// =====================================================================================
// store.js — Où vivent les données
//
// Deux modes, choisis automatiquement :
//   - localStorage (défaut) : la page est ouverte en fichier ou servie par un serveur statique
//     (python -m http.server, GitHub Pages). Tout reste dans le navigateur, comme avant.
//   - serveur : la page est servie par server/server.js, qui injecte l'état complet dans
//     window.OJA_STATE avant les scripts. Les lectures viennent de ce cache, les écritures
//     partent vers PUT /api/state/<clé> (regroupées), et un léger sondage prévient si un
//     autre appareil a modifié les données.
//
// Le reste de l'application ne sait pas dans quel mode elle tourne : elle appelle
// STORE.get / STORE.set / STORE.remove, toujours de façon synchrone.
// =====================================================================================

const STORE = (() => {
  const serverMode = Boolean(typeof window !== 'undefined' && window.OJA_STATE && typeof window.OJA_STATE === 'object');
  const cache = serverMode ? { ...window.OJA_STATE.data } : null;
  let version = serverMode ? Number(window.OJA_STATE.version || 0) : 0;
  const queue = new Map();      // clé -> valeur à envoyer
  let flushTimer = null;
  let syncing = false;

  function get(key) {
    if (serverMode) return cache[key] === undefined ? null : cache[key];
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function set(key, value) {
    if (!serverMode) { localStorage.setItem(key, JSON.stringify(value)); return; }
    cache[key] = value;
    queue.set(key, value);
    scheduleFlush();
  }

  function remove(key) {
    if (!serverMode) { localStorage.removeItem(key); return; }
    delete cache[key];
    queue.set(key, null);
    scheduleFlush();
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  }

  async function flush() {
    if (!queue.size || syncing) return;
    syncing = true;
    const batch = Object.fromEntries(queue);
    queue.clear();
    try {
      const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      version = Number(result.version || version);
      setStatus('ok');
    } catch (error) {
      // On remet le lot en attente : il repartira au prochain flush. La vendeuse continue à
      // travailler ; le bandeau lui dit que la sauvegarde attend.
      Object.entries(batch).forEach(([key, value]) => { if (!queue.has(key)) queue.set(key, value); });
      setStatus('offline');
      setTimeout(flush, 3000);
    } finally {
      syncing = false;
      if (queue.size) scheduleFlush();
    }
  }

  // Sondage discret : un autre appareil a-t-il changé les données ?
  async function poll() {
    if (queue.size || syncing) return;
    try {
      const response = await fetch('/api/version', { cache: 'no-store' });
      if (!response.ok) return;
      const remote = Number((await response.json()).version || 0);
      if (remote > version) setStatus('stale');
    } catch { /* hors ligne : le prochain flush le dira */ }
  }

  function setStatus(status) {
    const banner = document.querySelector('#sync-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', status === 'ok');
    if (status === 'offline') banner.innerHTML = 'Serveur injoignable : vos modifications sont gardées ici et repartiront dès que la connexion revient.';
    if (status === 'stale') banner.innerHTML = 'Les données ont changé sur un autre appareil. <button type="button" id="sync-reload">Recharger</button>';
    const button = banner.querySelector('#sync-reload');
    if (button) button.addEventListener('click', () => location.reload());
  }

  if (serverMode) {
    window.addEventListener('beforeunload', () => { if (queue.size) { try { navigator.sendBeacon('/api/state', new Blob([JSON.stringify(Object.fromEntries(queue))], { type: 'application/json' })); } catch { /* tant pis */ } } });
    setInterval(poll, 8000);
  }

  return { get, set, remove, serverMode, flush };
})();
