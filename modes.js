/* Contador WOD 2.2.5 Beta: ejercicios y estadísticas de rendimiento. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SESSION_KEY = 'contador-wod-v2.2-session';
  const PREFERENCES_KEY = 'contador-wod-v2.2-preferences';
  const LEGACY_KEY = 'contador-vueltas-v2'; // SOLO LECTURA. No sobrescribir la sesión 2.1.
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
  let prefs = { keepAwake: true, wodSound: true, startCountdown10: true };

  // Temporizador de preparación COMPARTIDO por todos los modos.
  // No persiste como sesión activa: al cerrar/ocultar la app se cancela.
  let prestart = null;
  let prestartInterval = 0;
  const prestartApi = {
    enabled: () => prefs.startCountdown10,
    active: mode => Boolean(prestart && (!mode || prestart.mode === mode)),
    remaining: mode => prestart && prestart.mode === mode ? prestart.remaining : null,
    cancel() {
      if (!prestart) return;
      const callback = prestart.onCancel;
      prestart = null;
      clearInterval(prestartInterval);
      prestartInterval = 0;
      callback?.();
    },
    begin(mode, { onTick, onGo, onCancel }) {
      this.cancel();
      if (!prefs.startCountdown10 || document.hidden) return false;
      const deadline = performance.now() + 10000;
      prestart = { mode, onTick, onGo, onCancel, remaining: 10 };
      const update = () => {
        const target = prestart;
        if (!target || target.mode !== mode) return;
        if (document.hidden) { this.cancel(); return; }
        const timeLeft = deadline - performance.now();
        if (timeLeft <= 0) {
          prestart = null;
          clearInterval(prestartInterval);
          prestartInterval = 0;
          target.onGo?.();
          return;
        }
        const seconds = Math.ceil(timeLeft / 1000);
        if (seconds !== target.remaining) {
          target.remaining = seconds;
          target.onTick?.(seconds);
        }
      };
      onTick?.(10);
      prestartInterval = setInterval(update, 70);
      return true;
    }
  };
  window.contadorPrestart = prestartApi;
  document.addEventListener('visibilitychange', () => { if (document.hidden) prestartApi.cancel(); });
  window.addEventListener('pagehide', () => prestartApi.cancel());

  // La instantánea viaja como fragmento URL para compatibilidad entre apps aisladas en iOS.
  function readIncomingWodMeta() {
    const q=new URLSearchParams(window.location.search);
    const raw=new URLSearchParams(window.location.hash.slice(1)).get('gw');
    if(!raw||raw.length>4500)return null;
    let m;try{m=JSON.parse(raw)}catch{return null;}
    if(!m||!/^wod-[a-zA-Z0-9-]{1,95}$/.test(m.id||'')||m.id!==q.get('wodid')||
       !/^\d{4}-\d{2}-\d{2}$/.test(m.date||'')||m.mode!==q.get('mode')||
       typeof m.title!=='string'||!m.title.trim()||m.title.length>140||
       !Array.isArray(m.movements)||m.movements.length<1||m.movements.length>8||
       !m.movements.every(x=>x&&typeof x.name==='string'&&x.name.length<=100&&typeof x.amount==='string'&&x.amount.length<=100))return null;
    return {id:m.id,date:m.date,title:m.title,mode:m.mode,strategy:m.strategy,level:m.level,
      objective:m.objective,profileName:m.profileName,movements:m.movements,patterns:m.patterns,
      readiness:m.readiness,effort:m.effort,...(m.mode==='fortime'&&Number.isInteger(m.rounds)&&m.rounds>=1&&m.rounds<=100?{rounds:m.rounds}:{})};
  }
  function newRunId(){return 'cw-'+Date.now()+'-'+Math.floor(Math.random()*1e8).toString(36);}
  function transferResultUrl(session=current) {
    if(!session||session.status!=='finished'||session.source!=='generador-wod'||!session.sourceWod)return null;
    const t=Math.max(0,Math.round(session.elapsedBeforeRun));
    const minutes=Math.floor(t/60000), sec=String(Math.floor(t/1000)%60).padStart(2,'0');
    let result;
    if(session.mode==='amrap')result=`${session.splits.length} rondas${session.extraReps?' + '+session.extraReps+' reps':''} · ${minutes}:${sec}`;
    else if(session.mode==='fortime'){
      const target=session.config.targetRounds;
      const count=target?`${session.splits.length}/${target} rondas`:`${session.splits.length} vueltas marcadas`;
      const label=session.finishReason==='limit'?'CAP':session.finishReason==='goal'?'FOR TIME':target?'FOR TIME incompleto':'FOR TIME';
      result=`${label} ${minutes}:${sec} · ${count}${target&&session.finishReason==='limit'?' · Incompleto':''}`;
    }
    else if(session.mode==='emom')result=`EMOM ${session.doneIntervals.length}/${session.config.intervals} intervalos marcados · ${minutes}:${sec}`;
    else result=`TABATA ${session.finishReason==='limit'?'completado':'detenido'} · ${minutes}:${sec}`;
    const payload={version:1,from:'contador-wod',runId:session.runId||'cw-'+session.finishedAt,
      finishedAt:session.finishedAt,elapsedMs:t,finishReason:session.finishReason,
      mode:session.mode,splitsCount:session.splits.length,extraReps:session.extraReps||0,
      doneIntervals:session.doneIntervals.length,splitTimesMs:session.splits.slice(0,120).map(x=>Math.round(x)),markedIntervals:session.doneIntervals.slice(0,120),result,wod:session.sourceWod};
    const url=new URL('https://borjagrande.github.io/generador-wod-beta/');
    url.hash='wodresult='+encodeURIComponent(JSON.stringify(payload));return url.href;
  }
  function updateResultTransferButton(){
    const link=$('sendWodResultBtn'),hint=$('sendWodResultHint');
    let url=null;try{url=transferResultUrl()}catch(err){console.warn('Transferencia no disponible:',err);}
    link.hidden=!url;hint.hidden=!url;
    if(url)link.href=url;else link.removeAttribute('href');
  }
  const safeRead = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { notice('No se puede guardar la sesión en este navegador'); } };
  const integer = (id, min, max) => {
    const number = Number($(id).value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
  };
  // Protocolo de transferencia desde Generador WOD: sólo configuración temporal.
  // Rechazar datos incompletos o alterados sin modificar sesiones existentes.
  function incomingConfig(search = window.location.search) {
    const q = new URLSearchParams(search);
    if(q.get('from') !== 'generador-wod') return null;
    if(q.get('v') !== '1') throw new Error('Enlace de generador no compatible.');
    const read = (key, min, max) => {
      const raw=q.get(key);
      if(raw===null || !/^\d{1,4}$/.test(raw)) throw new Error(`Falta o no es válido: ${key}.`);
      const n=Number(raw);
      if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Valor fuera de rango: ${key}.`);
      return n;
    };
    const mode=q.get('mode');
    let config;
    if(mode==='amrap')config={minutes:read('minutes',1,180)};
    else if(mode==='fortime')config={capMinutes:read('cap',0,60),...(q.has('rounds')?{targetRounds:read('rounds',1,100)}:{})};
    else if(mode==='emom')config={intervals:read('intervals',1,120),seconds:read('seconds',10,600)};
    else if(mode==='tabata'){
      const rounds=read('rounds',1,60),work=read('work',5,600),rest=read('rest',5,600);
      const configBlocks=q.has('blocks')||q.has('perblock')||q.has('break');
      if(configBlocks){
        const blocks=read('blocks',1,6),perBlock=read('perblock',1,60),breakSeconds=read('break',0,600);
        if(blocks*perBlock!==rounds)throw new Error('Rondas y bloques TABATA no coinciden.');
        config={rounds,work,rest,blocks,roundsPerBlock:perBlock,breakSeconds};
      }else config={rounds,work,rest};
    }else throw new Error('Modalidad de WOD no reconocida.');
    return {mode,config};
  }
  function tabataTotalMs(c){
    return c.rounds*(c.work+c.rest)*1000 + (c.blocks>1?(c.blocks-1)*(c.breakSeconds||0)*1000:0);
  }
  function tabataPhase(c,t) {
    if(!(c.blocks>1 && c.breakSeconds>0))return null;
    const blockMs=c.roundsPerBlock*(c.work+c.rest)*1000, breakMs=c.breakSeconds*1000;
    const block=Math.min(c.blocks-1,Math.floor(t/(blockMs+breakMs)));
    const within=t-block*(blockMs+breakMs);
    if(within>=blockMs && block<c.blocks-1){
      const remaining=Math.max(0,breakMs-(within-blockMs));
      return {id:`blockbreak-${block}`,text:`DESCANSO ENTRE BLOQUES · ${block+1}/${c.blocks}`,sub:`Siguiente bloque ${block+2} / ${c.blocks}`,remaining,progress:1-remaining/breakMs,index:(block+1)*c.roundsPerBlock,resting:true};
    }
    const cycle=(c.work+c.rest)*1000, row=Math.min(c.roundsPerBlock-1,Math.floor(within/cycle));
    const cycleMs=within-row*cycle, working=cycleMs<c.work*1000;
    const phaseMs=(working?c.work:c.rest)*1000;
    const remaining=working?c.work*1000-cycleMs:cycle-cycleMs;
    return {id:`${block}-${row}-${working?'work':'rest'}`,text:`${working?'TRABAJO':'DESCANSO'} · BLOQUE ${block+1}/${c.blocks} · RONDA ${row+1}/${c.roundsPerBlock}`,sub:`${working?c.work:c.rest} segundos`,remaining:Math.max(0,remaining),progress:1-Math.max(0,remaining)/phaseMs,index:block*c.roundsPerBlock+row+1,resting:!working};
  }
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
      prefs.startCountdown10 = fromStore.startCountdown10 !== false;
    } else {
      const original = safeRead(LEGACY_KEY);
      if (original && typeof original.soundEnabled === 'boolean') prefs.wodSound = original.soundEnabled;
    }
    window.contadorWakeEnabled = prefs.keepAwake;
    updatePreferencesUI();
  }

  function updatePreferencesUI() {
    for (const id of ['keepScreenPicker', 'keepScreenLegacy', 'keepScreenWod']) $(id).checked = prefs.keepAwake;
    for (const id of ['countdownPicker', 'countdownLegacy', 'countdownWod']) $(id).checked = prefs.startCountdown10;
    wodSoundBtn.textContent = prefs.wodSound ? 'SONIDO' : 'SILENCIO';
    wodSoundBtn.setAttribute('aria-label', prefs.wodSound ? 'Desactivar sonido de WOD' : 'Activar sonido de WOD');
  }

  function setCountdownEnabled(enabled) {
    prefs.startCountdown10 = enabled;
    safeWrite(PREFERENCES_KEY, prefs);
    if (!enabled) prestartApi.cancel();
    updatePreferencesUI();
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
    if (session.mode === 'tabata') return tabataTotalMs(c);
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
      const special=tabataPhase(c,t);
      if(special)return special;
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
      return { id: 'f', text: c.targetRounds ? `RONDAS ${current.splits.length}/${c.targetRounds}` : `${current.splits.length} ${current.splits.length === 1 ? 'VUELTA' : 'VUELTAS'}`, sub: total ? `Cap ${format(total)} · restante ${format(total - t)}` : 'Sin tiempo límite', remaining: total ? Math.max(0, total - t) : null, progress: total ? t / total : 0 };
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

  function finish(reason = 'manual', markedTime = null) {
    if (!current || !['running', 'paused'].includes(current.status)) return;
    const max = totalDuration();
    const time = markedTime ?? elapsed();
    if (current.mode==='fortime' && reason==='manual' && max!==null && time>=max) reason='limit';
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

  function start(skipCountdown = false) {
    if (!current || !['ready', 'paused'].includes(current.status)) return;
    if (prestartApi.active('wod')) { prestartApi.cancel(); return; }
    if (!skipCountdown && current.status === 'ready' && prestartApi.enabled()) {
      prestartApi.begin('wod', {
        onTick: seconds => { renderUI(); if (seconds <= 3) sound(760, .08); },
        onGo: () => start(true),
        onCancel: () => renderUI()
      });
      sound(650, .05); // Desbloquea el audio mediante el toque del usuario.
      return;
    }
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
    const max = totalDuration();
    if (max !== null && t >= max) { finish('limit'); return; }
    if (current.mode === 'amrap' || current.mode === 'fortime') {
      const last = current.splits.at(-1) || 0;
      if (t - last < 250) { notice('Espera un instante antes de registrar otra vuelta'); return; }
      current.splits.push(t);
      if (current.mode === 'fortime' && current.config.targetRounds && current.splits.length === current.config.targetRounds) { finish('goal', t); return; }
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
    if (session.mode === 'fortime') return `${session.config.targetRounds ? session.config.targetRounds + ' rondas · ' : ''}${session.config.capMinutes ? `Cap: ${session.config.capMinutes} min` : 'Sin tiempo límite'}`;
    if (session.mode === 'emom') return `${session.config.intervals} intervalos de ${session.config.seconds} s`;
    if (session.mode === 'tabata') return `${session.config.rounds} rondas · ${session.config.work} s trabajo / ${session.config.rest} s descanso${session.config.blocks>1?` · ${session.config.blocks} bloques con ${session.config.breakSeconds||0} s entre bloques`:''}`;
    return '';
  }

  // La descripción se muestra tal como llega del Generador; nunca se inventan cargas.
  function exerciseRows(session = current) {
    const rows = session?.sourceWod?.movements;
    return Array.isArray(rows) ? rows.filter(m => m && typeof m.name === 'string' && typeof m.amount === 'string').slice(0, 8) : [];
  }
  let exerciseKey = null, activeExerciseKey = null, lastTabataWork = null;
  function renderExercises() {
    const rows = exerciseRows();
    const key = JSON.stringify([current?.runId, current?.sourceWod?.title, current?.mode, rows]);
    if (key === exerciseKey) return;
    exerciseKey = key; activeExerciseKey = null;
    const panel = $('wodExercisePanel'), list = $('wodExerciseList');
    panel.hidden = !rows.length;
    panel.open = true;
    list.replaceChildren();
    if (!rows.length) return;
    $('wodExerciseTitle').textContent = current.sourceWod.title || 'Entrenamiento importado';
    $('wodExerciseCount').textContent = `${rows.length} mov.`;
    rows.forEach((m, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.textContent = `${i + 1}. ${m.name}`;
      const amount = document.createElement('strong'); amount.textContent = m.amount;
      li.append(name, amount); list.append(li);
    });
    $('wodExerciseHint').textContent = current.mode === 'emom' ? 'Estaciones en orden, una por intervalo.' : current.mode === 'tabata' ? 'Consulta los movimientos del programa.' : 'Movimientos en el orden recibido del Generador.';
  }
  function renderActiveExercise(info, done) {
    const rows = exerciseRows();
    let index = -1, label = '';
    if (!done && rows.length && current.mode === 'emom') {
      index = (info.index - 1) % rows.length;
      label = current.doneIntervals.includes(info.index) ? 'ESTACIÓN MARCADA' : 'ESTACIÓN ACTUAL';
    } else if (!done && rows.length && current.mode === 'tabata') {
      const c = current.config, blocks = c.blocks || 1, per = c.roundsPerBlock || c.rounds;
      // Solo señalar el movimiento cuando la correspondencia bloque/ejercicio es inequívoca.
      if (rows.length === blocks) {
        const between = info.id.startsWith('blockbreak-');
        index = Math.min(blocks - 1, between ? Math.floor(info.index / per) : Math.floor((info.index - 1) / per));
        label = between ? 'SIGUIENTE BLOQUE' : info.resting ? 'DESCANSO · EJERCICIO DEL BLOQUE' : 'EJERCICIO DEL BLOQUE';
      }
    }
    const key = `${index}|${label}|${rows[index]?.name}|${rows[index]?.amount}`;
    if (key === activeExerciseKey) return;
    activeExerciseKey = key;
    $('wodActiveExercise').hidden = index < 0;
    $('wodActiveLabel').textContent = label;
    $('wodActiveText').textContent = index < 0 ? '' : `${rows[index].amount} · ${rows[index].name}`;
    Array.from($('wodExerciseList').children).forEach((li,i) => li.classList.toggle('active-exercise', i === index));
  }
  function roundDurations(session = current) {
    return session.splits.map((t,i) => t - (session.splits[i-1] || 0));
  }
  function tabataWorkCompleted(c, t) {
    const per = c.roundsPerBlock || c.rounds;
    const cycle = (c.work+c.rest)*1000;
    let count = 0;
    for (let i=0;i<c.rounds;i++) {
      const end = i*cycle + Math.floor(i/per)*(c.breakSeconds||0)*1000 + c.work*1000;
      if (t >= end) count++;
    }
    return count;
  }
  function renderPerformance() {
    const panel = $('wodPerformance'), grid = $('wodPerformanceGrid'), pace = $('wodPaceList');
    const isRounds = ['amrap','fortime'].includes(current.mode);
    const ds = isRounds ? roundDurations() : [];
    const finished = current.status === 'finished';
    panel.hidden = current.status === 'ready' || (isRounds && !ds.length && !finished);
    grid.replaceChildren(); pace.replaceChildren(); $('wodPacePanel').hidden = !ds.length;
    if (panel.hidden) return;
    const add = (label, value) => {
      const box = document.createElement('div'); box.className = 'stat';
      const name = document.createElement('div'); name.className='stat-name'; name.textContent=label;
      const val = document.createElement('div'); val.className='stat-value'; val.textContent=value;
      box.append(name,val); grid.append(box);
    };
    let note = '';
    if (isRounds) {
      $('wodPerformanceTitle').textContent = current.mode === 'amrap' ? 'Estadísticas de rondas' : 'Estadísticas de vueltas';
      const best = ds.length ? Math.min(...ds) : 0, worst = ds.length ? Math.max(...ds) : 0;
      add('ÚLTIMA', ds.length ? format(ds.at(-1)) : '—');
      add('MEDIA', ds.length ? format(ds.reduce((a,b)=>a+b,0)/ds.length) : '—');
      add('MEJOR', ds.length ? format(best) : '—');
      add('MÁS LENTA', ds.length ? format(worst) : '—');
      if (finished) add('TRAS ÚLTIMA MARCA', format(Math.max(0,current.elapsedBeforeRun-(current.splits.at(-1)||0))));
      note = ds.length ? 'Solo marcas completas registradas. El tiempo posterior a la última marca no entra en la media.' : 'No se registraron rondas o vueltas completas.';
      ds.forEach((d,i) => {
        const row = document.createElement('div'); row.className='wod-pace-row';
        const label = document.createElement('span'); label.textContent=`${i+1}`;
        const track = document.createElement('div'); track.className='wod-pace-track';
        const bar = document.createElement('div'); bar.className='wod-pace-bar';
        if (ds.length>1 && best!==worst) bar.classList.add(d===best?'fast':d===worst?'slow':'normal');
        bar.style.width=`${worst ? d/worst*100 : 0}%`; track.append(bar);
        const val = document.createElement('strong'); val.textContent=format(d);
        const delta = document.createElement('span'); delta.className='wod-pace-delta';
        const diff = i ? d-ds[i-1] : null;
        delta.textContent = diff===null ? '—' : `${diff>0?'+':diff<0?'−':''}${format(Math.abs(diff))}`;
        row.append(label,track,val,delta); pace.append(row);
      });
    } else if (current.mode === 'emom') {
      $('wodPerformanceTitle').textContent = 'Estadísticas de intervalos';
      const count = current.doneIntervals.length;
      add('MARCADOS', `${count}/${current.config.intervals}`);
      add('SIN MARCAR', String(Math.max(0,current.config.intervals-count)));
      add('% DEL PROGRAMA', `${Math.round(count/current.config.intervals*100)} %`);
      note = 'HECHO registra el cumplimiento manual, no el tiempo de ejecución ni las repeticiones.';
    } else {
      $('wodPerformanceTitle').textContent = 'Estadísticas de intervalos';
      const done = tabataWorkCompleted(current.config, elapsed());
      add('TRABAJO TRANSCURRIDO', `${done}/${current.config.rounds}`);
      add('TIEMPO PROGRAMADO', format(totalDuration()));
      note = 'Intervalos de trabajo cuyo tiempo ha transcurrido; no acredita repeticiones ni ejecución real.';
    }
    $('wodPerformanceNote').textContent=note;
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
    $('wodPhase').textContent = isDone ? (current.mode==='fortime'&&current.config.targetRounds&&current.finishReason!=='goal'?'WOD INCOMPLETO':'ENTRENAMIENTO FINALIZADO') : info.text;
    $('wodSubTime').textContent = isDone ? description() : info.sub;
    $('wodProgressFill').style.width = `${Math.max(0, Math.min(100, isDone ? 100 : (info.progress || 0) * 100))}%`;
    if (current.mode === 'tabata' && !isDone) {
      $('wodScore').textContent = `Ronda ${info.index} de ${current.config.rounds}`;
      $('wodCount').textContent = `${info.index} de ${current.config.rounds} rondas`;
      // Actualizar el resumen TABATA únicamente cuando cambia el número de trabajos transcurridos.
      const workDone = tabataWorkCompleted(current.config, t);
      if (lastTabataWork !== workDone && current.status === 'running') { lastTabataWork=workDone; renderPerformance(); }
    }
    renderActiveExercise(info, isDone);
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
    updateResultTransferButton();
    const t = elapsed();
    const amount = current.mode === 'emom' ? current.doneIntervals.length : current.mode === 'tabata' ? (finished ? tabataWorkCompleted(current.config, t) : Math.min(current.config.rounds, phaseAt(t).index)) : current.splits.length;
    $('wodCount').textContent = current.mode === 'emom' ? `${amount} marcados` : current.mode === 'tabata' ? (finished ? `${amount}/${current.config.rounds} trabajos` : `${amount} rondas`) : `${amount} ${amount === 1 ? 'vuelta' : 'vueltas'}`;
    $('wodHistoryTitle').textContent = current.mode === 'emom' ? 'Intervalos completados' : current.mode === 'tabata' ? 'Programa de intervalos' : 'Historial de vueltas';
    const reason = current.finishReason === 'limit';
    if (current.mode === 'amrap') {
      $('wodScore').textContent = `${current.splits.length} rondas${finished && current.extraReps ? ' + ' + current.extraReps + ' reps' : ''}`;
      $('wodResultDetails').textContent = finished ? `Tiempo: ${format(t)} · ${reason ? 'Tiempo completado' : 'Finalización manual'}` : `Tiempo acumulado: ${format(t)}`;
    } else if (current.mode === 'fortime') {
      const target=current.config.targetRounds;
      const count=target?`${current.splits.length}/${target} rondas`:`${current.splits.length} vueltas`;
      $('wodScore').textContent = finished ? (reason ? `CAP · ${format(t)}` : format(t)) : count;
      $('wodResultDetails').textContent = finished ? `${count}${target?(current.finishReason==='goal'?' · Completado':' · Incompleto'+(reason?' (CAP)':' · Finalización manual')):' registradas'}` : (current.config.capMinutes ? 'Cuenta ascendente con cap' : 'Cuenta ascendente sin límite');
    } else if (current.mode === 'emom') {
      $('wodScore').textContent = `${current.doneIntervals.length} / ${current.config.intervals} completados`;
      $('wodResultDetails').textContent = finished ? `Duración: ${format(t)}` : 'Marca HECHO dentro de cada intervalo';
    } else {
      $('wodScore').textContent = finished ? (reason ? `${current.config.rounds} rondas completadas` : `Detenido · ${tabataWorkCompleted(current.config,t)}/${current.config.rounds} trabajos transcurridos`) : `Ronda ${Math.min(current.config.rounds, phaseAt(t).index)} de ${current.config.rounds}`;
      $('wodResultDetails').textContent = finished ? `Tiempo: ${format(t)}${reason ? '' : ' · Detenido manualmente'}` : description();
    }
    renderExercises();
    renderPerformance();
    renderClock(t, phaseAt(t));
    const preparacion = prestartApi.remaining('wod');
    if (preparacion !== null) {
      $('wodStatusText').textContent = 'CUENTA ATRÁS DE SALIDA';
      $('wodTimer').textContent = format(preparacion * 1000);
      $('wodPhase').textContent = `PREPARACIÓN · ${preparacion} s`;
      $('wodSubTime').textContent = 'El tiempo del WOD comenzará después';
      $('wodMainText').textContent = 'CANCELAR';
      $('wodMainSub').textContent = 'Cancelar cuenta atrás';
      main.setAttribute('aria-label', 'Cancelar cuenta atrás');
      main.classList.add('prestarting');
      $('wodProgressFill').style.width = '0%';
    } else main.classList.remove('prestarting');
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
    if (prestartApi.active() && currentScreen !== screen) prestartApi.cancel();
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
    if (session.mode === 'fortime' && (!valid(c.capMinutes, 0, 60) || (c.targetRounds!==undefined && (!valid(c.targetRounds,1,100)||session.splits.length>c.targetRounds)))) return false;
    if (session.mode === 'emom' && !(valid(c.intervals, 1, 120) && valid(c.seconds, 10, 600))) return false;
    if (session.mode === 'emom' && session.doneIntervals.some(x => x > c.intervals)) return false;
    if (session.mode === 'tabata' && !(valid(c.rounds, 1, 60) && valid(c.work, 5, 600) && valid(c.rest, 5, 600))) return false;
    if(session.mode==='tabata' && c.blocks!==undefined && !(valid(c.blocks,1,6)&&valid(c.roundsPerBlock,1,60)&&valid(c.breakSeconds,0,600)&&c.blocks*c.roundsPerBlock===c.rounds))return false;
    if (session.status === 'running' && !Number.isFinite(session.wallStart)) return false;
    if(session.sourceWod && (!/^wod-[a-zA-Z0-9-]{1,95}$/.test(session.sourceWod.id||'')||session.sourceWod.mode!==session.mode))delete session.sourceWod;
    session.extraReps = Number.isInteger(session.extraReps) && session.extraReps >= 0 && session.extraReps <= 999 ? session.extraReps : 0;
    return true;
  }

  function applyIncomingConfig() {
    let prepared;
    try{prepared=incomingConfig();}
    catch(err){notice(`No se pudo preparar el WOD: ${err.message}`);return false;}
    if(!prepared)return false;
    // Una sesión en curso o terminada requiere aprobación antes de sustituirse.
    if(current && ['running','paused','finished'].includes(current.status)) {
      if(!window.confirm('Hay una sesión anterior en el Contador WOD. ¿Quieres sustituirla por el nuevo entrenamiento? Los resultados de la anterior podrían perderse.'))return false;
    }
    prestartApi.cancel();
    if(current?.status==='running')cancelAnimationFrame(rafId);
    releaseWake();resetCues();
    current={version:1,mode:prepared.mode,status:'ready',config:prepared.config,elapsedBeforeRun:0,wallStart:0,splits:[],doneIntervals:[],extraReps:0,finishReason:null,finishedAt:null,source:'generador-wod',sourceWod:readIncomingWodMeta(),runId:newRunId()};
    $('extraReps').value='0';
    persist();show('wod');
    // Evita volver a importar la misma URL tras refrescar; la sesión READY ya está guardada.
    try{history.replaceState(null,'',window.location.pathname+window.location.hash);}catch(_){}
    notice('WOD preparado desde Generador. Pulsa INICIAR cuando estés listo.');
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
    const movements=exerciseRows();
    if(movements.length){
      rows.push(['Ejercicio','Cantidad']);
      // Evitar fórmulas de hoja de cálculo en texto importado.
      const safeCell = x => /^[\s]*[=+@-]/.test(x) ? "'"+x : x;
      movements.forEach(m=>rows.push([safeCell(m.name),safeCell(m.amount)]));
      rows.push([]);
    }
    if (current.mode === 'amrap' || current.mode === 'fortime') {
      const ds=roundDurations();
      if(ds.length)rows.push(['Media',format(ds.reduce((a,b)=>a+b,0)/ds.length)],['Mejor',format(Math.min(...ds))],['Más lenta',format(Math.max(...ds))]);
      if(current.status==='finished')rows.push(['Tiempo tras última marca',format(Math.max(0,current.elapsedBeforeRun-(current.splits.at(-1)||0)))]);
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
    for (const id of ['countdownPicker', 'countdownLegacy', 'countdownWod']) $(id).addEventListener('change', e => setCountdownEnabled(e.target.checked));
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
      prestartApi.cancel();
      const mode = current.mode, config = { ...current.config };
      cancelAnimationFrame(rafId); releaseWake(); resetCues();
      current = { version: 1, mode, status: 'ready', config, elapsedBeforeRun: 0, wallStart: 0, splits: [], doneIntervals: [], extraReps: 0, finishReason: null, finishedAt: null,source:current.source,sourceWod:current.sourceWod,runId:newRunId() };
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
    // No tocar el contador original 2.1 si está en marcha.
    if (legacy && (legacy.state === 'running' || legacy.state === 'paused')) {
      show('legacy');
      if(new URLSearchParams(window.location.search).get('from')==='generador-wod') notice('Finaliza el contador de vueltas antes de importar un WOD.');
    } else if (!applyIncomingConfig()) {
      if (current) { show('wod'); if (current.status === 'running') tick(); }
      else show('picker');
    }
  }
  init();
})();
