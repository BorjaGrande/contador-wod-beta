/* Contador WOD 2.2.0-beta: nuevos modos aislados del cronómetro original 2.1. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SESSION_KEY = 'contador-wod-v2.2-session-beta-preview';
  const PREFERENCES_KEY = 'contador-wod-v2.2-preferences-beta-preview';
  const LEGACY_KEY = 'contador-vueltas-v2-beta-preview'; // SOLO LECTURA. No sobrescribir la sesión 2.1.
  const modes = { vueltas: 'VUELTAS', amrap: 'AMRAP', fortime: 'FOR TIME', emom: 'EMOM', tabata: 'TABATA' };
  const selectedScreen = $('modeSelectScreen');
  const legacyScreen = $('legacyScreen');
  const wodScreen = $('wodScreen');
  const picker = $('wodConfig');
  const modeNavBtn = $('modeNavBtn');
  const soundBtn = $('soundBtn');
  const wodSoundBtn = $('wodSoundBtn');
  const toastEl = $('toast');
  let toastTimeout = 0;
  let chosenMode = null;
  let currentScreen = 'picker';
  let current = null;
  let rafId = 0;
  let monotonicStart = 0;
  let wakeLock = null;
  let audioCtx = null;
  let lastCuePhase = null;
  let lastCueSecond = null;
  let lastCueElapsed = null;
  let prefs = { keepAwake: true, wodSound: true };

  const safeRead = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { notice('No se puede guardar la sesión en este navegador'); } };
  const integer = (id, min, max) => {
    const number = Number($(id).value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
  };
  const format = value => {
    const d = Math.floor(Math.max(0, value) / 100);
    const tenth = d % 10;
    const s = Math.floor(d / 10) % 60;
    const minutes = Math.floor(d / 600);
    if (minutes >= 60) return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
    return `${String(minutes).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
  };
  const notice = message => {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 2300);
  };

  function loadPreferences() {
    const fromStore = safeRead(PREFERENCES_KEY);
    if (fromStore && typeof fromStore === 'object') {
      prefs.keepAwake = fromStore.keepAwake !== false;
      if (typeof fromStore.wodSound === 'boolean') prefs.wodSound = fromStore.wodSound;
    } else {
      const original = safeRead(LEGACY_KEY);
      if (original && typeof original.soundEnabled === 'boolean') prefs.wodSound = original.soundEnabled;
    }
    window.contadorWakeEnabled = prefs.keepAwake;
    updatePreferencesUI();
  }

  function updatePreferencesUI() {
    for (const id of ['keepScreenPicker', 'keepScreenLegacy', 'keepScreenWod']) $(id).checked = prefs.keepAwake;
    wodSoundBtn.textContent = prefs.wodSound ? 'SONIDO' : 'SILENCIO';
    wodSoundBtn.setAttribute('aria-label', prefs.wodSound ? 'Desactivar sonido de WOD' : 'Activar sonido de WOD');
  }

  function setWakeEnabled(enabled) {
    prefs.keepAwake = enabled;
    window.contadorWakeEnabled = enabled;
    safeWrite(PREFERENCES_KEY, prefs);
    updatePreferencesUI();
    document.dispatchEvent(new Event('contador-wake-change'));
    if (current?.status === 'running' && currentScreen === 'wod' && enabled) keepAwake();
    else if (!enabled) releaseWake();
  }

  async function keepAwake() {
    if (!prefs.keepAwake || currentScreen !== 'wod' || current?.status !== 'running' || document.hidden || !('wakeLock' in navigator) || wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!prefs.keepAwake || currentScreen !== 'wod' || current?.status !== 'running' || document.hidden) { await lock.release(); return; }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch (_) { /* iOS puede denegar la solicitud, por ejemplo con ahorro de batería */ }
  }
  function releaseWake() {
    if (!wakeLock) return;
    const lock = wakeLock; wakeLock = null;
    lock.release().catch(() => {});
  }

  function sound(frequency = 930, duration = 0.09) {
    if (!prefs.wodSound || document.hidden) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Audio();
      const ctx = audioCtx;
      const play = () => {
        if (ctx !== audioCtx || ctx.state !== 'running') return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = frequency;
        const now = ctx.currentTime;
        g.gain.setValueAtTime(.13, now);
        g.gain.exponentialRampToValueAtTime(.001, now + duration);
        o.connect(g); g.connect(ctx.destination);
        o.start(now); o.stop(now + duration);
      };
      if (ctx.state !== 'running') ctx.resume().then(play).catch(() => {});
      else play();
    } catch (_) { /* permitido que el navegador bloquee el audio */ }
  }
  const vibrate = pattern => { try { navigator.vibrate?.(pattern); } catch (_) {} };

  function totalDuration(session = current) {
    if (!session) return null;
    const c = session.config;
    if (session.mode === 'amrap') return c.minutes * 60000;
    if (session.mode === 'fortime') return c.capMinutes ? c.capMinutes * 60000 : null;
    if (session.mode === 'emom') return c.intervals * c.seconds * 1000;
    if (session.mode === 'tabata') return c.rounds * (c.work + c.rest) * 1000;
    return null;
  }

  function elapsed() {
    if (!current) return 0;
    if (current.status !== 'running') return current.elapsedBeforeRun;
    // Usa reloj monotónico mientras está abierto y reloj real para cierres/suspensiones de iOS.
    return current.elapsedBeforeRun + Math.max(0, performance.now() - monotonicStart, Date.now() - current.wallStart);
  }

  function persist() { if (current) safeWrite(SESSION_KEY, current); }
  function phaseAt(t) {
    const c = current.config;
    if (current.mode === 'emom') {
      const step = c.seconds * 1000;
      const index = Math.min(c.intervals - 1, Math.floor(t / step));
      return { id: `e${index}`, text: `INTERVALO ${index + 1} / ${c.intervals}`, sub: `EMOM de ${c.seconds} s`, remaining: Math.max(0, step - (t - index * step)), progress: (t - index * step) / step, index: index + 1 };
    }
    if (current.mode === 'tabata') {
      const work = c.work * 1000, rest = c.rest * 1000, cycle = work + rest;
      const index = Math.min(c.rounds - 1, Math.floor(t / cycle));
      const cycleTime = Math.max(0, t - index * cycle);
      const working = cycleTime < work;
      const remaining = Math.max(0, (working ? work : cycle) - cycleTime);
      const phaseLength = working ? work : rest;
      return { id: `${index}-${working ? 'work' : 'rest'}`, text: working ? `TRABAJO · ${index + 1}/${c.rounds}` : `DESCANSO · ${index + 1}/${c.rounds}`, sub: `${working ? c.work : c.rest} segundos`, remaining, progress: 1 - remaining / phaseLength, index: index + 1, resting: !working };
    }
    const total = totalDuration();
    if (current.mode === 'amrap') {
      return { id: 'a', text: `RONDA ${current.splits.length + 1}`, sub: `Tiempo acumulado ${format(t)}`, remaining: Math.max(0, total - t), progress: t / total };
    }
    if (current.mode === 'fortime') {
      return { id: 'f', text: `${current.splits.length} ${current.splits.length === 1 ? 'VUELTA' : 'VUELTAS'}`, sub: total ? `Cap ${format(total)} · restante ${format(total - t)}` : 'Sin tiempo límite', remaining: total ? Math.max(0, total - t) : null, progress: total ? t / total : 0 };
    }
    return { id: '-', text: '', sub: '', remaining: null, progress: 0 };
  }

  function resetCues() { lastCuePhase = null; lastCueSecond = null; lastCueElapsed = null; }
  function cueTransitions(info, time) {
    if (lastCueElapsed !== null && time - lastCueElapsed >= 0 && time - lastCueElapsed <= 1800 && !document.hidden) {
      if (lastCuePhase !== null && info.id !== lastCuePhase) sound(info.resting ? 560 : 1100, .16);
      const sec = info.remaining === null ? null : Math.ceil(info.remaining / 1000);
      if (sec !== lastCueSecond && sec !== null && sec >= 1 && sec <= 3 && sec * 1000 >= info.remaining) sound(1050, .05);
    }
    lastCuePhase = info.id;
    lastCueSecond = info.remaining === null ? null : Math.ceil(info.remaining / 1000);
    lastCueElapsed = time;
  }

  function finish(reason = 'manual') {
    if (!current || !['running', 'paused'].includes(current.status)) return;
    const max = totalDuration();
    const time = elapsed();
    current.elapsedBeforeRun = reason === 'limit' && max !== null ? max : Math.round(time);
    current.wallStart = 0;
    current.status = 'finished';
    current.finishReason = reason;
    current.finishedAt = Date.now();
    cancelAnimationFrame(rafId);
    releaseWake();
    resetCues();
    persist();
    renderAll();
    sound(660, .34);
    vibrate([40, 40, 70]);
  }

  function ensureLimit() {
    if (!current || current.status !== 'running') return false;
    const max = totalDuration();
    if (max !== null && elapsed() >= max) { finish('limit'); return true; }
    return false;
  }

  function tick() {
    cancelAnimationFrame(rafId);
    if (!current || current.status !== 'running') return;
    if (ensureLimit()) return;
    const t = elapsed();
    const info = phaseAt(t);
    cueTransitions(info, t);
    renderClock(t, info);
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (!current || !['ready', 'paused'].includes(current.status)) return;
    current.status = 'running';
    current.wallStart = Date.now();
    monotonicStart = performance.now();
    persist();
    resetCues();
    renderAll();
    tick(); keepAwake(); sound(880); vibrate(22);
  }
  function pause() {
    if (!current || current.status !== 'running') return;
    if (ensureLimit()) return;
    current.elapsedBeforeRun = Math.round(elapsed());
    current.status = 'paused';
    current.wallStart = 0;
    cancelAnimationFrame(rafId); releaseWake(); resetCues();
    persist(); renderAll(); sound(520); vibrate(30);
  }
  function record() {
    if (!current || current.status !== 'running') return;
    if (ensureLimit()) return;
    const t = Math.round(elapsed());
    if (current.mode === 'amrap' || current.mode === 'fortime') {
      const last = current.splits.at(-1) || 0;
      if (t - last < 250) { notice('Espera un instante antes de registrar otra vuelta'); return; }
      current.splits.push(t);
      persist(); renderHistory(); renderUI(); sound(1200, .1); vibrate([20, 30, 20]);
    } else if (current.mode === 'emom') {
      const interval = phaseAt(t).index;
      if (current.doneIntervals.includes(interval)) { notice('Intervalo ya marcado'); return; }
      current.doneIntervals.push(interval);
      persist(); renderHistory(); renderUI(); sound(1250, .1); vibrate(28);
    }
  }
  function undo() {
    if (!current || current.status === 'ready' || current.status === 'finished') return;
    if (['amrap', 'fortime'].includes(current.mode)) current.splits.pop();
    else if (current.mode === 'emom') current.doneIntervals.pop();
    persist(); renderAll(); notice('Último registro deshecho');
  }

  function description(session = current) {
    if (session.mode === 'amrap') return `${session.config.minutes} minutos`;
    if (session.mode === 'fortime') return session.config.capMinutes ? `Cap: ${session.config.capMinutes} min` : 'Sin tiempo límite';
    if (session.mode === 'emom') return `${session.config.intervals} intervalos de ${session.config.seconds} s`;
    if (session.mode === 'tabata') return `${session.config.rounds} rondas · ${session.config.work} s trabajo / ${session.config.rest} s descanso`;
    return '';
  }

  function renderClock(t = elapsed(), info = phaseAt(t)) {
    if (!current) return;
    const total = totalDuration();
    const isDone = current.status === 'finished';
    if (['amrap', 'emom', 'tabata'].includes(current.mode)) {
      $('wodTimer').textContent = format(isDone ? 0 : info.remaining);
    } else {
      $('wodTimer').textContent = format(t);
    }
    $('wodPhase').textContent = isDone ? 'ENTRENAMIENTO FINALIZADO' : info.text;
    $('wodSubTime').textContent = isDone ? description() : info.sub;
    $('wodProgressFill').style.width = `${Math.max(0, Math.min(100, isDone ? 100 : (info.progress || 0) * 100))}%`;
    if (current.mode === 'tabata' && !isDone) {
      $('wodScore').textContent = `Ronda ${info.index} de ${current.config.rounds}`;
      $('wodCount').textContent = `${info.index} de ${current.config.rounds} rondas`;
    }
    wodScreen.classList.toggle('resting', Boolean(info.resting && !isDone));
    wodScreen.classList.toggle('finished', isDone);
    if (total === null && current.mode === 'fortime') $('wodProgressFill').style.width = '0%';
  }

  function renderUI() {
    if (!current) return;
    const status = current.status;
    const running = status === 'running';
    const active = running || status === 'paused';
    const finished = status === 'finished';
    $('wodStatus').className = `status ${finished ? 'finished' : status}`;
    $('wodStatusText').textContent = ({ ready: 'LISTO PARA EMPEZAR', running: 'ENTRENAMIENTO EN MARCHA', paused: 'EN PAUSA', finished: 'FINALIZADO' })[status];
    $('wodModeTitle').textContent = modes[current.mode];
    $('wodModeDescription').textContent = description();
    const main = $('wodMainBtn');
    main.classList.toggle('running', running);
    main.disabled = finished || (current.mode === 'tabata' && running);
    $('wodMainText').textContent = finished ? 'TERMINADO' : status === 'ready' ? 'INICIAR' : status === 'paused' ? 'CONTINUAR' : current.mode === 'amrap' ? '+ RONDA' : current.mode === 'fortime' ? '+ VUELTA' : current.mode === 'emom' ? 'HECHO' : 'EN MARCHA';
    $('wodMainSub').textContent = finished ? 'Consulta tu resultado' : status === 'ready' ? 'Toca para empezar' : status === 'paused' ? 'Reanudar tiempo' : current.mode === 'tabata' ? 'Sigue las fases' : 'Toca al completar';
    main.setAttribute('aria-label', $('wodMainText').textContent);
    $('wodPauseBtn').disabled = !active;
    $('wodPauseBtn').textContent = status === 'paused' ? 'REANUDAR' : 'PAUSAR';
    $('wodFinishBtn').disabled = !active;
    $('wodFinishBtn').textContent = current.mode === 'fortime' ? 'FINALIZAR WOD' : 'DETENER WOD';
    const canUndo = active && (current.mode === 'emom' ? current.doneIntervals.length : current.splits.length) > 0 && current.mode !== 'tabata';
    $('wodUndoBtn').disabled = !canUndo;
    $('wodUndoBtn').hidden = current.mode === 'tabata';
    $('repsBox').hidden = !(current.mode === 'amrap' && finished);
    $('wodExportBtn').disabled = status === 'ready';
    const t = elapsed();
    const amount = current.mode === 'emom' ? current.doneIntervals.length : current.mode === 'tabata' ? (finished ? current.config.rounds : Math.min(current.config.rounds, Math.ceil(t / ((current.config.work + current.config.rest) * 1000)))) : current.splits.length;
    $('wodCount').textContent = current.mode === 'emom' ? `${amount} marcados` : current.mode === 'tabata' ? `${amount} rondas` : `${amount} ${amount === 1 ? 'vuelta' : 'vueltas'}`;
    $('wodHistoryTitle').textContent = current.mode === 'emom' ? 'Intervalos completados' : current.mode === 'tabata' ? 'Programa de intervalos' : 'Historial de vueltas';
    const reason = current.finishReason === 'limit';
    if (current.mode === 'amrap') {
      $('wodScore').textContent = `${current.splits.length} rondas${finished && current.extraReps ? ' + ' + current.extraReps + ' reps' : ''}`;
      $('wodResultDetails').textContent = finished ? `Tiempo: ${format(t)} · ${reason ? 'Tiempo completado' : 'Finalización manual'}` : `Tiempo acumulado: ${format(t)}`;
    } else if (current.mode === 'fortime') {
      $('wodScore').textContent = finished ? (reason ? `CAP · ${format(t)}` : format(t)) : `${current.splits.length} vueltas`;
      $('wodResultDetails').textContent = finished ? `${current.splits.length} vueltas registradas` : (current.config.capMinutes ? 'Cuenta ascendente con cap' : 'Cuenta ascendente sin límite');
    } else if (current.mode === 'emom') {
      $('wodScore').textContent = `${current.doneIntervals.length} / ${current.config.intervals} completados`;
      $('wodResultDetails').textContent = finished ? `Duración: ${format(t)}` : 'Marca HECHO dentro de cada intervalo';
    } else {
      $('wodScore').textContent = finished ? (reason ? `${current.config.rounds} rondas completadas` : `Detenido · ${Math.min(current.config.rounds, Math.ceil(t / ((current.config.work + current.config.rest) * 1000)))} rondas iniciadas`) : `Ronda ${Math.min(current.config.rounds, Math.floor(t / ((current.config.work + current.config.rest) * 1000)) + 1)} de ${current.config.rounds}`;
      $('wodResultDetails').textContent = finished ? `Tiempo: ${format(t)}${reason ? '' : ' · Detenido manualmente'}` : description();
    }
    renderClock(t, phaseAt(t));
  }

  function renderHistory() {
    if (!current) return;
    const list = $('wodHistory');
    list.replaceChildren();
    const add = (name, timing, foot = '') => {
      const li = document.createElement('li'); li.className = 'lap-item';
      const n = document.createElement('div'); n.className = 'lap-number'; n.textContent = name;
      const box = document.createElement('div');
      const tm = document.createElement('div'); tm.className = 'lap-duration'; tm.textContent = timing;
      box.appendChild(tm);
      if (foot) { const s = document.createElement('div'); s.className = 'lap-total'; s.textContent = foot; box.appendChild(s); }
      li.append(n, box); list.append(li);
    };
    if (current.mode === 'amrap' || current.mode === 'fortime') {
      for (let i = current.splits.length - 1; i >= 0; i--) {
        const duration = current.splits[i] - (current.splits[i - 1] || 0);
        add(`${current.mode === 'amrap' ? 'Ronda' : 'Vuelta'} ${i + 1}`, format(duration), `Total ${format(current.splits[i])}`);
      }
    } else if (current.mode === 'emom') {
      for (const index of [...current.doneIntervals].reverse()) add(`Intervalo ${index}`, 'HECHO', `De ${current.config.intervals}`);
    } else if (current.mode === 'tabata') {
      add(`Trabajo: ${current.config.work} s`, `${current.config.rounds} rondas`, `Descanso: ${current.config.rest} s`);
    }
    if (!list.children.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Las rondas aparecerán aquí al registrarlas.'; list.append(li); }
  }
  function renderAll() { renderHistory(); renderUI(); }

  function show(screen) {
    currentScreen = screen;
    selectedScreen.hidden = screen !== 'picker';
    legacyScreen.hidden = screen !== 'legacy';
    wodScreen.hidden = screen !== 'wod';
    modeNavBtn.hidden = screen !== 'legacy';
    soundBtn.hidden = screen !== 'legacy';
    wodSoundBtn.hidden = screen !== 'wod';
    $('appTitle').textContent = screen === 'legacy' ? 'Contador de vueltas' : 'Contador WOD';
    if (screen !== 'wod') releaseWake();
    if (screen === 'wod') { renderAll(); if (current?.status === 'running') keepAwake(); }
  }

  function createSession(mode) {
    let config;
    if (mode === 'amrap') {
      const minutes = integer('amrapMinutes', 1, 180);
      if (minutes === null) return notice('Duración: de 1 a 180 minutos');
      config = { minutes };
    } else if (mode === 'fortime') {
      const capMinutes = integer('forTimeCap', 0, 60);
      if (capMinutes === null) return notice('Cap no válido');
      config = { capMinutes };
    } else if (mode === 'emom') {
      const intervals = integer('emomIntervals', 1, 120), seconds = integer('emomSeconds', 10, 600);
      if (intervals === null || seconds === null) return notice('Intervalos o segundos no válidos');
      config = { intervals, seconds };
    } else if (mode === 'tabata') {
      const rounds = integer('tabataRounds', 1, 60), work = integer('tabataWork', 5, 600), rest = integer('tabataRest', 5, 600);
      if ([rounds, work, rest].some(x => x === null)) return notice('Parámetros Tabata no válidos');
      config = { rounds, work, rest };
    } else return;
    current = { version: 1, mode, status: 'ready', config, elapsedBeforeRun: 0, wallStart: 0, splits: [], doneIntervals: [], extraReps: 0, finishReason: null, finishedAt: null };
    $('extraReps').value = '0';
    persist(); resetCues(); show('wod');
  }

  function validateSaved(session) {
    if (!session || session.version !== 1 || !['amrap', 'fortime', 'emom', 'tabata'].includes(session.mode) || !['ready', 'running', 'paused', 'finished'].includes(session.status) || typeof session.config !== 'object') return false;
    if (!Number.isFinite(session.elapsedBeforeRun) || session.elapsedBeforeRun < 0 || !Array.isArray(session.splits) || !Array.isArray(session.doneIntervals)) return false;
    if (!session.splits.every((s, i, a) => Number.isFinite(s) && s >= 0 && (i === 0 || s > a[i - 1]))) return false;
    if (!session.doneIntervals.every(x => Number.isInteger(x) && x >= 1)) return false;
    if (new Set(session.doneIntervals).size !== session.doneIntervals.length) return false;
    const c = session.config;
    const valid = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
    if (session.mode === 'amrap' && !valid(c.minutes, 1, 180)) return false;
    if (session.mode === 'fortime' && !valid(c.capMinutes, 0, 60)) return false;
    if (session.mode === 'emom' && !(valid(c.intervals, 1, 120) && valid(c.seconds, 10, 600))) return false;
    if (session.mode === 'emom' && session.doneIntervals.some(x => x > c.intervals)) return false;
    if (session.mode === 'tabata' && !(valid(c.rounds, 1, 60) && valid(c.work, 5, 600) && valid(c.rest, 5, 600))) return false;
    if (session.status === 'running' && !Number.isFinite(session.wallStart)) return false;
    session.extraReps = Number.isInteger(session.extraReps) && session.extraReps >= 0 && session.extraReps <= 999 ? session.extraReps : 0;
    return true;
  }

  function loadSession() {
    const saved = safeRead(SESSION_KEY);
    if (!validateSaved(saved)) return;
    current = saved;
    if (current.status === 'running') {
      current.elapsedBeforeRun += Math.max(0, Date.now() - current.wallStart);
      current.wallStart = Date.now();
      monotonicStart = performance.now();
      // Si pasó el límite mientras estaba cerrada, finalizar con el tiempo exacto.
      if (!ensureLimit()) persist();
    }
    $('extraReps').value = String(current.extraReps);
  }

  function exportCSV() {
    if (!current || current.status === 'ready') return;
    const rows = [['Modo', modes[current.mode]], ['Configuración', description()], ['Estado', current.status], ['Tiempo', format(elapsed())], ['Resultado', $('wodScore').textContent], []];
    if (current.mode === 'amrap' || current.mode === 'fortime') {
      rows.push(['Número', 'Duración', 'Total']);
      current.splits.forEach((time, i) => rows.push([String(i + 1), format(time - (current.splits[i - 1] || 0)), format(time)]));
      if (current.mode === 'amrap') rows.push(['Repeticiones adicionales', String(current.extraReps)]);
    } else if (current.mode === 'emom') {
      rows.push(['Intervalos marcados', current.doneIntervals.join(', ')]);
    } else {
      rows.push(['Rondas', String(current.config.rounds)], ['Trabajo (s)', String(current.config.work)], ['Descanso (s)', String(current.config.rest)]);
    }
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url;
    a.download = `contador_wod_${current.mode}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    notice('Resultados exportados');
  }

  function init() {
    loadPreferences();
    loadSession();
    for (const id of ['keepScreenPicker', 'keepScreenLegacy', 'keepScreenWod']) $(id).addEventListener('change', e => setWakeEnabled(e.target.checked));
    wodSoundBtn.addEventListener('click', () => {
      prefs.wodSound = !prefs.wodSound;
      safeWrite(PREFERENCES_KEY, prefs); updatePreferencesUI();
      if (prefs.wodSound) sound(920);
    });
    for (const tile of document.querySelectorAll('.mode-tile')) tile.addEventListener('click', () => {
      chosenMode = tile.dataset.mode;
      for (const el of document.querySelectorAll('.mode-tile')) el.classList.toggle('active', el === tile);
      if (chosenMode === 'vueltas') { picker.hidden = true; show('legacy'); return; }
      $('configTitle').textContent = `CONFIGURAR ${modes[chosenMode]}`;
      for (const row of document.querySelectorAll('[data-config]')) row.hidden = row.dataset.config !== chosenMode;
      picker.hidden = false;
    });
    $('prepareWodBtn').addEventListener('click', () => { if (chosenMode && chosenMode !== 'vueltas') createSession(chosenMode); });
    modeNavBtn.addEventListener('click', () => {
      const legacy = safeRead(LEGACY_KEY);
      if (legacy && (legacy.state === 'running' || legacy.state === 'paused')) {
        notice('Reinicia el contador de vueltas antes de cambiar de modo'); return;
      }
      show('picker');
    });
    $('changeModeBtn').addEventListener('click', () => {
      if (current && ['running', 'paused'].includes(current.status) && !window.confirm('¿Descartar la sesión actual y cambiar de modo? Los resultados de este WOD se perderán.')) return;
      cancelAnimationFrame(rafId); releaseWake(); current = null;
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      resetCues(); show('picker');
    });
    $('wodMainBtn').addEventListener('click', () => {
      if (!current) return;
      if (current.status === 'ready' || current.status === 'paused') start();
      else if (current.status === 'running') record();
    });
    $('wodPauseBtn').addEventListener('click', () => { if (current?.status === 'running') pause(); else if (current?.status === 'paused') start(); });
    $('wodFinishBtn').addEventListener('click', () => {
      if (!current || !['running', 'paused'].includes(current.status)) return;
      if (window.confirm(current.mode === 'fortime' ? '¿Finalizar el FOR TIME ahora?' : '¿Detener el entrenamiento antes de que termine el tiempo?')) finish('manual');
    });
    $('wodResetBtn').addEventListener('click', () => {
      if (!current) return;
      if (!window.confirm('¿Reiniciar esta sesión? Se borrarán las rondas y los registros de este WOD.')) return;
      const mode = current.mode, config = { ...current.config };
      cancelAnimationFrame(rafId); releaseWake(); resetCues();
      current = { version: 1, mode, status: 'ready', config, elapsedBeforeRun: 0, wallStart: 0, splits: [], doneIntervals: [], extraReps: 0, finishReason: null, finishedAt: null };
      $('extraReps').value = '0';
      persist(); renderAll(); notice('Sesión reiniciada');
    });
    $('wodUndoBtn').addEventListener('click', undo);
    $('wodExportBtn').addEventListener('click', exportCSV);
    $('extraReps').addEventListener('change', () => {
      if (!current || current.mode !== 'amrap' || current.status !== 'finished') return;
      const n = integer('extraReps', 0, 999);
      if (n === null) { $('extraReps').value = String(current.extraReps); return notice('Repeticiones: entre 0 y 999'); }
      current.extraReps = n; persist(); renderUI();
    });
    document.addEventListener('keydown', event => {
      if (currentScreen !== 'wod' || !current || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target?.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); if (current.status === 'running') record(); else if (['ready', 'paused'].includes(current.status)) start(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { releaseWake(); resetCues(); }
      else if (currentScreen === 'wod' && current?.status === 'running') { keepAwake(); tick(); }
    });
    window.addEventListener('pagehide', releaseWake);
    const legacy = safeRead(LEGACY_KEY);
    if (legacy && (legacy.state === 'running' || legacy.state === 'paused')) show('legacy');
    else if (current) { show('wod'); if (current.status === 'running') tick(); }
    else show('picker');
  }
  init();
})();
