/* Screen Wake Lock compartido. Nunca implica que iOS permita alarmas en segundo plano. */
(() => {
  'use strict';
  let owner = null, sentinel = null, pending = false, retry = 0, failures = 0, status = 'idle';
  const visible = () => !document.hidden;
  const wanted = () => Boolean(owner && window.contadorWakeEnabled !== false && visible());
  function display(next) {
    status = next;
    const labels = { idle:'', requesting:'Solicitando mantener la pantalla encendida…', active:'Pantalla encendida: protección activa.', blocked:'iOS o el navegador no ha concedido el permiso. Abre en Safari o desde la pantalla de inicio y comprueba el bloqueo automático.', unsupported:'Este navegador no permite mantener la pantalla encendida desde la web.' };
    for (const el of document.querySelectorAll('[data-wake-status]')) {
      el.textContent = labels[status]; el.hidden = status === 'idle'; el.dataset.state = status;
    }
  }
  function stopRetry() { clearTimeout(retry); retry = 0; }
  function release() {
    stopRetry(); failures = 0;
    const old = sentinel; sentinel = null;
    if (old && !old.released) Promise.resolve(old.release()).catch(() => {});
    display('idle');
  }
  function schedule() {
    if (!wanted() || retry || failures >= 3) return;
    retry = setTimeout(() => { retry = 0; request(); }, 1500);
  }
  async function request() {
    if (!wanted()) return;
    if (sentinel && !sentinel.released) { display('active'); return; }
    if (pending) return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') { display('unsupported'); return; }
    pending = true; display('requesting');
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!wanted()) { if (!lock.released) await lock.release(); return; }
      if (lock.released) { failures++; display('blocked'); schedule(); return; }
      sentinel = lock; failures = 0; display('active');
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (wanted()) { failures++; display('blocked'); schedule(); }
        else display('idle');
      });
    } catch (_) {
      if (wanted()) { failures++; display('blocked'); schedule(); }
    } finally { pending = false; }
  }
  function refresh() {
    if (!wanted()) { release(); return; }
    failures = 0; stopRetry(); request();
  }
  window.contadorWake = {
    start(id) { if (owner !== id) { owner = id; failures = 0; stopRetry(); } if (wanted()) request(); else release(); },
    stop(id) { if (owner !== id) return; owner = null; release(); },
    refresh,
    status: () => status
  };
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('contador-wake-change', refresh);
  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', refresh);
  // Reintento directo bajo un gesto del usuario si el navegador exige activación.
  document.addEventListener('pointerup', () => { if (wanted() && !sentinel) refresh(); });
})();
