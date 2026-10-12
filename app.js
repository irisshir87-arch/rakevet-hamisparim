"use strict";

const NUMBER_WORDS = {
  1: "אחד", 2: "שתיים", 3: "שלוש", 4: "ארבע", 5: "חמש",
  6: "שש", 7: "שבע", 8: "שמונה", 9: "תשע", 10: "עשר"
};
const COUNT_WORDS = {
  1: "אחד", 2: "שניים", 3: "שלושה", 4: "ארבעה", 5: "חמישה",
  6: "שישה", 7: "שבעה", 8: "שמונה", 9: "תשעה", 10: "עשרה"
};

function safeGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}
const ITEM_WORDS = {
  1: "תפוח אחד", 2: "שני תפוחים", 3: "שלושה תפוחים", 4: "ארבעה תפוחים", 5: "חמישה תפוחים",
  6: "שישה תפוחים", 7: "שבעה תפוחים", 8: "שמונה תפוחים", 9: "תשעה תפוחים", 10: "עשרה תפוחים"
};
const COLORS = ["#ef6f6c", "#5aa9e6", "#75c79b", "#f4c95d", "#f59f63", "#9b87db", "#58c4c7", "#e887b7", "#8db86c", "#d98d5f"];
const LIGHT_COLORS = ["#ffe2e1", "#e0f2ff", "#e4f6ea", "#fff3c9", "#ffeadb", "#ece7ff", "#dcf6f6", "#fde4f0", "#edf5df", "#f7e5da"];
const ITEM = "🍎";
const storedRange = Number(safeGet("numberTrainRange", "5") || 5);

const state = {
  route: "home",
  range: Math.min(10, Math.max(5, Number.isFinite(storedRange) ? storedRange : 5)),
  sound: safeGet("numberTrainSound", "on") !== "off",
  trainRound: 0,
  trainOrder: [],
  trainCounts: {},
  trainLocked: false,
  missingNumber: 1,
  missingScore: Number(safeGet("numberTrainMissingScore", "0") || 0),
  completedTrainRounds: Number(safeGet("numberTrainCompleted", "0") || 0),
  catchRound: 0,
  catchScore: 0,
  catchTarget: 1,
  catchLocked: false
};
if (navigator.webdriver) state.sound = false;

const screen = document.getElementById("screen");
const homeBtn = document.getElementById("homeBtn");
const soundBtn = document.getElementById("soundBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const toast = document.getElementById("toast");
const confettiLayer = document.getElementById("confetti");
let toastTimer = null;
let dragSession = null;
let catchMoveTimer = null;

function cloneTemplate(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function numbersInRange() {
  return Array.from({ length: state.range }, (_, i) => i + 1);
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomItem(values) {
  return values[Math.floor(Math.random() * values.length)];
}

let hebrewVoice = null;
let availableVoices = [];
let activeOnlineAudio = null;
let activeUtterance = null;
let activeSpeechCancel = null;
let speechSession = 0;
let speechQueue = Promise.resolve();
let audioCtx = null;

const isAndroid = /Android/i.test(navigator.userAgent || "");
const sharedOnlineAudio = new Audio();
sharedOnlineAudio.preload = "auto";
sharedOnlineAudio.playsInline = true;

// Critical number pronunciations use real Hebrew recordings instead of TTS.
// These files are hosted by Wikimedia Commons and are used under CC BY-SA.
// The starting level (1–5) is therefore independent of the device's TTS engine.
const NUMBER_AUDIO_URLS = {
  1: "https://upload.wikimedia.org/wikipedia/commons/c/c0/He-il-akhat.ogg",
  2: "https://upload.wikimedia.org/wikipedia/commons/1/16/He-il-shtaim.ogg",
  3: "https://upload.wikimedia.org/wikipedia/commons/2/26/He-il-shalosh.ogg",
  4: "https://upload.wikimedia.org/wikipedia/commons/1/11/He-il-arba.ogg",
  5: "https://upload.wikimedia.org/wikipedia/commons/2/2c/He-il-khamesh.ogg",
  6: "https://upload.wikimedia.org/wikipedia/commons/4/4f/He-il-shesh.ogg",
  7: "https://upload.wikimedia.org/wikipedia/commons/2/2b/He-il-sheva.ogg"
};
const sharedNumberAudio = new Audio();
sharedNumberAudio.preload = "auto";
sharedNumberAudio.playsInline = true;

function refreshHebrewVoice() {
  hebrewVoice = null;
  availableVoices = [];
  if (!("speechSynthesis" in window)) return;
  try {
    availableVoices = window.speechSynthesis.getVoices() || [];
    hebrewVoice = availableVoices.find(v => {
      const lang = String(v.lang || "").toLowerCase().replace("_", "-");
      return lang === "he-il" || lang === "he" || lang.startsWith("he-") || lang.startsWith("iw-");
    }) || availableVoices.find(v => /hebrew|עברית/i.test(String(v.name || ""))) || null;
  } catch (_) {
    availableVoices = [];
    hebrewVoice = null;
  }
}

function ensureAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioCtx();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch (_) {
    return null;
  }
}

function primeAudioFromGesture() {
  ensureAudioContext();
  refreshHebrewVoice();
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.resume(); } catch (_) {}
  }
}

function stopActiveSpeech() {
  const cancel = activeSpeechCancel;
  activeSpeechCancel = null;
  if (cancel) {
    try { cancel(); } catch (_) {}
  }
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  activeUtterance = null;
  if (activeOnlineAudio) {
    try {
      activeOnlineAudio.pause();
      activeOnlineAudio.currentTime = 0;
    } catch (_) {}
    activeOnlineAudio = null;
  }
  try {
    sharedNumberAudio.pause();
    sharedNumberAudio.currentTime = 0;
    sharedNumberAudio.onended = null;
    sharedNumberAudio.onerror = null;
  } catch (_) {}
}

function resetSpeechQueue() {
  speechSession++;
  stopActiveSpeech();
  speechQueue = Promise.resolve();
}

function onlineTtsUrls(text) {
  const encoded = encodeURIComponent(text);
  // Some Android browsers handle the classic translate.google.com endpoint
  // better than translate.googleapis.com, so Android tries it first.
  const classic = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=he&q=${encoded}`;
  const api = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=he&q=${encoded}`;
  return isAndroid ? [classic, api] : [api, classic];
}

function playNativeHebrew(text, session, useExplicitVoice) {
  return new Promise(resolve => {
    if (session !== speechSession || !state.sound || !("speechSynthesis" in window)) {
      resolve(false);
      return;
    }
    if (useExplicitVoice && !hebrewVoice) {
      resolve(false);
      return;
    }

    let settled = false;
    let timeoutId = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (activeSpeechCancel === cancelPlayback) activeSpeechCancel = null;
      activeUtterance = null;
      resolve(result);
    };
    const cancelPlayback = () => {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      finish(false);
    };

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "he-IL";
      if (useExplicitVoice && hebrewVoice) utterance.voice = hebrewVoice;
      utterance.rate = 0.84;
      utterance.pitch = 1.03;
      utterance.volume = 1;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      activeUtterance = utterance;
      activeSpeechCancel = cancelPlayback;
      try { window.speechSynthesis.resume(); } catch (_) {}
      window.speechSynthesis.speak(utterance);
      // Android occasionally omits onend. Never let the narration queue freeze.
      timeoutId = setTimeout(() => finish(true), Math.max(3500, text.length * 140));
    } catch (_) {
      finish(false);
    }
  });
}

async function playOnlineHebrew(text, session, urlIndex = 0) {
  const urls = onlineTtsUrls(text);
  if (session !== speechSession || !state.sound || urlIndex >= urls.length) return false;

  return new Promise(resolve => {
    let settled = false;
    let timeoutId = null;
    const audio = sharedOnlineAudio;
    const cleanup = () => {
      clearTimeout(timeoutId);
      audio.onplaying = null;
      audio.onended = null;
      audio.onerror = null;
      if (activeOnlineAudio === audio) activeOnlineAudio = null;
      if (activeSpeechCancel === cancelPlayback) activeSpeechCancel = null;
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const cancelPlayback = () => {
      try { audio.pause(); audio.currentTime = 0; } catch (_) {}
      finish(false);
    };
    const tryNext = () => {
      if (settled) return;
      settled = true;
      cleanup();
      playOnlineHebrew(text, session, urlIndex + 1).then(resolve);
    };

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audio.src = urls[urlIndex];
      activeOnlineAudio = audio;
      activeSpeechCancel = cancelPlayback;
      audio.onended = () => finish(true);
      audio.onerror = tryNext;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(tryNext);
      timeoutId = setTimeout(tryNext, 8000);
    } catch (_) {
      tryNext();
    }
  });
}

async function playHebrewSpeech(text, session) {
  refreshHebrewVoice();

  // Best option: an actual Hebrew system voice (Samsung/Google/Windows).
  if (hebrewVoice) {
    const played = await playNativeHebrew(text, session, true);
    if (played || session !== speechSession || !state.sound) return played;
  }

  // On Android the voice list is sometimes empty even though the TTS engine can
  // speak the requested language. In that case let Android choose by lang=he-IL.
  if (isAndroid && availableVoices.length === 0 && "speechSynthesis" in window) {
    const played = await playNativeHebrew(text, session, false);
    if (played || session !== speechSession || !state.sound) return played;
  }

  // Fallback used successfully by the desktop version. Failure never blocks play.
  return playOnlineHebrew(text, session);
}

function speak(text) {
  if (!state.sound || !text) return Promise.resolve(false);
  const session = speechSession;
  const task = () => {
    if (session !== speechSession || !state.sound) return false;
    return playHebrewSpeech(text, session);
  };
  speechQueue = speechQueue.catch(() => false).then(task);
  return speechQueue;
}

function speakNow(text) {
  resetSpeechQueue();
  return speak(text);
}

function playRecordedNumber(number, session) {
  return new Promise(resolve => {
    if (session !== speechSession || !state.sound) {
      resolve(false);
      return;
    }
    const url = NUMBER_AUDIO_URLS[number];
    if (!url) {
      playHebrewSpeech(NUMBER_WORDS[number], session).then(resolve);
      return;
    }

    const audio = sharedNumberAudio;
    let settled = false;
    let timeoutId = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      audio.onended = null;
      audio.onerror = null;
      resolve(result);
    };

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audio.src = url;
      audio.onended = () => finish(true);
      audio.onerror = () => {
        // If a recording cannot load, fall back to the existing Hebrew TTS path.
        playHebrewSpeech(NUMBER_WORDS[number], session).then(finish);
      };
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => playHebrewSpeech(NUMBER_WORDS[number], session).then(finish));
      }
      timeoutId = setTimeout(() => finish(false), 4500);
    } catch (_) {
      playHebrewSpeech(NUMBER_WORDS[number], session).then(finish);
    }
  });
}

function speakNumber(number) {
  if (!state.sound || !number) return Promise.resolve(false);
  const session = speechSession;
  const task = () => {
    if (session !== speechSession || !state.sound) return false;
    return playRecordedNumber(number, session);
  };
  speechQueue = speechQueue.catch(() => false).then(task);
  return speechQueue;
}

function speakNumberNow(number) {
  resetSpeechQueue();
  if (!state.sound || !number) return Promise.resolve(false);
  const session = speechSession;
  // IMPORTANT: call audio.play() synchronously from the user's tap/click.
  // Android blocks it if we first defer through a Promise queue.
  const directPlayback = playRecordedNumber(number, session);
  speechQueue = directPlayback.catch(() => false);
  return directPlayback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function playTone(frequency = 540, duration = 0.16) {
  if (!state.sound) return;
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.02);
  } catch (_) {}
}

function showToast(message, type = "") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 1700);
}

function celebrate() {
  const symbols = ["⭐", "✨", "🎉", "🌟"];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.textContent = symbols[i % symbols.length];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    piece.style.animationDuration = `${1.15 + Math.random() * 0.8}s`;
    confettiLayer.appendChild(piece);
    setTimeout(() => piece.remove(), 2300);
  }
}


let arcadeTimer = null;
let dinoRaf = null;
let dinoLastFrame = 0;
let dinoSpawnElapsed = 0;
let dinoJumpTimer = null;
let fishingDrag = null;

const dinoState = {
  score: 0,
  target: 1,
  running: false,
  tokens: [],
  jumpActive: false,
  lastTokenWasTarget: false
};

const arcade = {
  round: 0,
  score: 0,
  target: 1,
  locked: false,
  count: 0,
  step: 1,
  previousTarget: 0
};

function clearRouteTimers() {
  clearInterval(catchMoveTimer);
  catchMoveTimer = null;
  clearInterval(arcadeTimer);
  arcadeTimer = null;
  if (dinoRaf) cancelAnimationFrame(dinoRaf);
  dinoRaf = null;
  dinoState.running = false;
  dinoState.tokens = [];
  clearTimeout(dinoJumpTimer);
  dinoJumpTimer = null;
  fishingDrag = null;
  resetSpeechQueue();
}

const ROUTE_RENDERERS = {
  home: renderHome,
  catch: startCatch,
  train: startTrain,
  bridge: startBridge,
  frog: startFrog,
  cannon: startCannon,
  obstacle: startObstacle,
  parking: startParking,
  monster: startMonster,
  fishing: startFishing,
  dino: startDino,
  rescue: startRescue,
  frogjump: startFrogJump,
  tower: startTower,
  runaway: startRunaway
};

function setRoute(route) {
  clearRouteTimers();
  state.route = route;
  homeBtn.classList.toggle("hidden", route === "home");
  screen.replaceChildren();
  const renderer = ROUTE_RENDERERS[route] || renderHome;
  renderer();
  screen.scrollTop = 0;
  screen.focus({ preventScroll: true });
}

function renderHome() {
  screen.appendChild(cloneTemplate("home-template"));
  screen.querySelectorAll("[data-route]").forEach(button => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });
  screen.querySelectorAll("[data-range]").forEach(button => {
    const range = Number(button.dataset.range);
    button.classList.toggle("active", range === state.range);
    button.addEventListener("click", () => {
      state.range = range;
      safeSet("numberTrainRange", String(state.range));
      screen.replaceChildren();
      renderHome();
      showToast(`עכשיו משחקים עם המספרים 1 עד ${state.range}`);
      speakNumberNow(state.range);
    });
  });
  const progress = screen.querySelector("#homeProgress");
  progress.textContent = "מתחילים ב־1–5 • מוסיפים מספר אחד בכל שלב";
}

function pickTarget(previous = arcade.previousTarget) {
  const nums = numbersInRange();
  const candidates = nums.filter(n => n !== previous);
  const value = randomItem(candidates.length ? candidates : nums);
  arcade.previousTarget = value;
  arcade.target = value;
  return value;
}

function choiceNumbers(target, count = 4) {
  const others = shuffle(numbersInRange().filter(n => n !== target));
  return shuffle([target, ...others.slice(0, Math.min(count - 1, others.length))]);
}

function missionBar(icon, title, target, scoreText = "") {
  return `
    <div class="arcade-heading">
      <div class="arcade-title"><span aria-hidden="true">${icon}</span><div><p class="eyebrow">לומדים מספרים במשחק</p><h1>${title}</h1></div></div>
      <div class="big-mission" aria-live="polite"><span class="mission-mini">🎯</span><strong>${target}</strong></div>
      ${scoreText ? `<div class="mini-score">${scoreText}</div>` : ""}
    </div>`;
}

function wrongChoice(button) {
  button.classList.remove("arcade-wrong");
  void button.offsetWidth;
  button.classList.add("arcade-wrong");
  playTone(185, 0.14);
  speakNumberNow(arcade.target);
}

function successChoice() {
  playTone(720, 0.12);
  celebrate();
}

async function nextArcadeRound(route, renderer, delay = 480) {
  arcade.round++;
  if (arcade.round >= 5) {
    celebrate();
    showToast("איזה יופי! סיימתם ⭐", "success");
    await speak("כל הכבוד!");
    if (state.route === route) setTimeout(() => setRoute("home"), 450);
    return;
  }
  setTimeout(() => {
    if (state.route === route) renderer();
  }, delay);
}

// ---------- Broken bridge / missing number ----------
function startBridge() {
  arcade.round = 0;
  arcade.score = 0;
  renderBridge();
}

function renderBridge() {
  const nums = numbersInRange();
  const interior = nums.filter(n => n > 1 && n < state.range);
  arcade.target = randomItem(interior.length ? interior : nums);
  screen.innerHTML = `
    <section class="mini-game bridge-game">
      ${missionBar("🌉", "הגשר השבור", "?", `${arcade.round}/5`)}
      <div class="bridge-scene">
        <div class="bridge-water" aria-hidden="true">≈ ≋ ≈ ≋ ≈</div>
        <div class="bridge-row" id="bridgeRow"></div>
      </div>
      <div class="choice-label">איזו אבן משלימה את הגשר?</div>
      <div class="rock-choices" id="bridgeChoices"></div>
    </section>`;
  const row = screen.querySelector("#bridgeRow");
  nums.forEach(n => {
    const tile = document.createElement("div");
    tile.className = n === arcade.target ? "bridge-gap" : "bridge-plank";
    tile.dataset.number = n;
    tile.textContent = n === arcade.target ? "" : n;
    row.appendChild(tile);
  });
  choiceNumbers(arcade.target, 3).forEach(n => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rock-choice";
    b.textContent = n;
    b.addEventListener("click", async () => {
      if (arcade.locked) return;
      if (n !== arcade.target) return wrongChoice(b);
      arcade.locked = true;
      const gap = screen.querySelector(".bridge-gap");
      gap.className = "bridge-plank bridge-filled";
      gap.textContent = n;
      successChoice();
      await speakNumberNow(n);
      arcade.locked = false;
      nextArcadeRound("bridge", renderBridge, 650);
    });
    screen.querySelector("#bridgeChoices").appendChild(b);
  });
}

// ---------- Hungry frog ----------
function startFrog() {
  arcade.round = 0;
  arcade.score = 0;
  renderFrog();
}

function renderFrog() {
  pickTarget();
  arcade.locked = false;
  screen.innerHTML = `
    <section class="mini-game frog-game">
      ${missionBar("🐸", "הצפרדע הרעבה", arcade.target, `${arcade.round}/5`)}
      <div class="frog-pond">
        <div class="fly-zone" id="flyZone"></div>
        <div class="frog-wrap"><div id="frogTongue" class="frog-tongue"></div><div class="big-frog">🐸</div></div>
      </div>
    </section>`;
  choiceNumbers(arcade.target, 4).forEach((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `number-fly fly-${i+1}`;
    b.innerHTML = `<span>🪰</span><strong>${n}</strong>`;
    b.addEventListener("click", async () => {
      if (arcade.locked) return;
      if (n !== arcade.target) return wrongChoice(b);
      arcade.locked = true;
      b.classList.add("frog-eaten");
      const tongue = screen.querySelector("#frogTongue");
      tongue.classList.add("shoot-tongue");
      successChoice();
      await speakNumberNow(n);
      nextArcadeRound("frog", renderFrog, 650);
    });
    screen.querySelector("#flyZone").appendChild(b);
  });
  speakNumber(arcade.target);
}

// ---------- Cannon ----------
function startCannon() {
  arcade.round = 0;
  renderCannon();
}

function renderCannon() {
  pickTarget();
  arcade.locked = false;
  screen.innerHTML = `
    <section class="mini-game cannon-game">
      ${missionBar("🎯", "תותח המספרים", arcade.target, `${arcade.round}/5`)}
      <div class="cannon-field">
        <div class="balloon-targets" id="balloonTargets"></div>
        <div class="cannon-wrap" aria-hidden="true"><div id="cannonBarrel" class="cannon-barrel"></div><div class="cannon-wheel"></div></div>
      </div>
    </section>`;
  choiceNumbers(arcade.target, 4).forEach((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `balloon-number balloon-${i+1}`;
    b.innerHTML = `<span>🎈</span><strong>${n}</strong>`;
    b.addEventListener("click", async () => {
      if (arcade.locked) return;
      if (n !== arcade.target) return wrongChoice(b);
      arcade.locked = true;
      b.classList.add("balloon-pop");
      screen.querySelector("#cannonBarrel").classList.add("cannon-fire");
      successChoice();
      await speakNumberNow(n);
      nextArcadeRound("cannon", renderCannon, 620);
    });
    screen.querySelector("#balloonTargets").appendChild(b);
  });
  speakNumber(arcade.target);
}

// ---------- Obstacle race ----------
function startObstacle() {
  arcade.round = 0;
  arcade.score = 0;
  renderObstacle();
}

function renderObstacle() {
  pickTarget();
  arcade.locked = false;
  const pct = (arcade.round / 5) * 100;
  screen.innerHTML = `
    <section class="mini-game obstacle-game">
      ${missionBar("🚧", "מרוץ מכשולים", arcade.target, `${arcade.round}/5`)}
      <div class="obstacle-course">
        <div class="obstacle-road">
          <div class="obstacle-finish">🏁</div>
          <div class="obstacle-car" id="obstacleCar" style="right:calc(${pct}% - 20px)">🏎️</div>
        </div>
        <div class="gate-title">איזה שער ייפתח?</div>
        <div class="number-gates" id="numberGates"></div>
      </div>
    </section>`;
  choiceNumbers(arcade.target, 3).forEach(n => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "number-gate";
    b.innerHTML = `<span class="gate-bars">▥</span><strong>${n}</strong>`;
    b.addEventListener("click", async () => {
      if (arcade.locked) return;
      if (n !== arcade.target) return wrongChoice(b);
      arcade.locked = true;
      b.classList.add("gate-open");
      const car = screen.querySelector("#obstacleCar");
      car.classList.add("obstacle-boost");
      successChoice();
      await speakNumberNow(n);
      nextArcadeRound("obstacle", renderObstacle, 680);
    });
    screen.querySelector("#numberGates").appendChild(b);
  });
  speakNumber(arcade.target);
}

// ---------- Parking ----------
function startParking() {
  arcade.round = 0;
  renderParking();
}

function renderParking() {
  pickTarget();
  arcade.locked = false;
  screen.innerHTML = `
    <section class="mini-game parking-game">
      ${missionBar("🅿️", "החניון", arcade.target, `${arcade.round}/5`)}
      <div class="parking-lot">
        <div class="parking-grid" id="parkingGrid"></div>
        <div class="parking-car-area"><button id="parkingCar" class="parking-car" type="button" aria-label="מכונית">🚗</button><span>גררו את המכונית או לחצו על החניה</span></div>
      </div>
    </section>`;
  const values = choiceNumbers(arcade.target, 4);
  values.forEach(n => {
    const spot = document.createElement("button");
    spot.type = "button";
    spot.className = "parking-spot";
    spot.dataset.number = n;
    spot.innerHTML = `<span>🅿️</span><strong>${n}</strong>`;
    spot.addEventListener("click", () => parkCar(n, spot));
    screen.querySelector("#parkingGrid").appendChild(spot);
  });
  enableParkingDrag(screen.querySelector("#parkingCar"));
  speakNumber(arcade.target);
}

function enableParkingDrag(car) {
  let session = null;
  car.addEventListener("pointerdown", e => {
    if (arcade.locked) return;
    car.setPointerCapture(e.pointerId);
    const ghost = document.createElement("div");
    ghost.className = "parking-car-ghost";
    ghost.textContent = "🚗";
    document.body.appendChild(ghost);
    session = {id:e.pointerId, ghost, moved:false, x:e.clientX, y:e.clientY};
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`;
  });
  car.addEventListener("pointermove", e => {
    if (!session || session.id !== e.pointerId) return;
    if (Math.hypot(e.clientX-session.x, e.clientY-session.y)>8) session.moved=true;
    session.ghost.style.left=`${e.clientX}px`; session.ghost.style.top=`${e.clientY}px`;
  });
  const end = e => {
    if (!session || session.id !== e.pointerId) return;
    const moved = session.moved;
    session.ghost.remove();
    session = null;
    if (!moved) return;
    const hit = document.elementFromPoint(e.clientX,e.clientY)?.closest?.(".parking-spot");
    if (hit) parkCar(Number(hit.dataset.number), hit);
  };
  car.addEventListener("pointerup", end);
  car.addEventListener("pointercancel", end);
}

async function parkCar(n, spot) {
  if (arcade.locked) return;
  if (n !== arcade.target) return wrongChoice(spot);
  arcade.locked = true;
  spot.classList.add("parked");
  spot.innerHTML = `<span class="parked-car">🚗</span><strong>${n}</strong>`;
  successChoice();
  await speakNumberNow(n);
  nextArcadeRound("parking", renderParking, 650);
}

// ---------- Monster quantity ----------
function startMonster() {
  arcade.round = 0;
  renderMonster();
}

function renderMonster() {
  pickTarget();
  arcade.count = 0;
  arcade.locked = false;
  screen.innerHTML = `
    <section class="mini-game monster-game">
      ${missionBar("👾", "המפלצת הרעבה", arcade.target, `${arcade.round}/5`)}
      <div class="monster-scene">
        <div class="monster-character">👾<div id="monsterCount" class="belly-count">0 / ${arcade.target}</div></div>
        <div class="cookie-tray" id="cookieTray"></div>
      </div>
    </section>`;
  const total = Math.min(10, arcade.target + 3);
  for (let i=0;i<total;i++) {
    const b=document.createElement("button");
    b.type="button"; b.className="food-item"; b.textContent="🍪";
    b.addEventListener("click",()=>feedMonster(b));
    screen.querySelector("#cookieTray").appendChild(b);
  }
  speakNumber(arcade.target);
}

async function feedMonster(button) {
  if (arcade.locked || button.classList.contains("used")) return;
  button.classList.add("used");
  arcade.count++;
  screen.querySelector("#monsterCount").textContent = `${arcade.count} / ${arcade.target}`;
  playTone(390+arcade.count*30,.08);
  speakNumberNow(arcade.count);
  if (arcade.count >= arcade.target) {
    arcade.locked=true;
    screen.querySelector(".monster-character").classList.add("monster-happy");
    successChoice();
    nextArcadeRound("monster", renderMonster, 750);
  }
}

// ---------- Fishing with a real rod ----------
function startFishing() {
  arcade.round = 0;
  renderFishing();
}

function renderFishing() {
  pickTarget();
  arcade.locked = false;
  fishingDrag = null;

  screen.innerHTML = `
    <section class="mini-game fishing-game">
      ${missionBar("🎣", "דגים מספרים", arcade.target, `${arcade.round}/5`)}
      <div class="fishing-help"><span aria-hidden="true">☝️</span> גררו את הקרס עד הדג עם המספר הזה</div>
      <div class="sea-scene fishing-sea" id="fishingSea">
        <div class="fishing-sky" aria-hidden="true">☁️ <span>☀️</span></div>
        <div class="water-line">〰️〰️〰️</div>

        <svg class="rod-line-layer" id="rodLineLayer" aria-hidden="true">
          <line id="rodLine" x1="92%" y1="4%" x2="78%" y2="25%"></line>
        </svg>
        <div class="rod-handle" aria-hidden="true">╲</div>
        <button type="button" class="fishing-hook" id="fishingHook" aria-label="קרס. גררו אותו אל הדג">🪝</button>

        <div class="fish-zone" id="fishZone"></div>
        <div class="fishing-shore" aria-hidden="true">🪨 🌿</div>
      </div>
    </section>`;

  const zone = screen.querySelector("#fishZone");
  choiceNumbers(arcade.target, 4).forEach((n, i) => {
    const fish = document.createElement("div");
    fish.className = `number-fish fish-${i + 1}`;
    fish.dataset.number = String(n);
    fish.innerHTML = `<span>🐟</span><strong>${n}</strong>`;
    zone.appendChild(fish);
  });

  const hook = screen.querySelector("#fishingHook");
  const sea = screen.querySelector("#fishingSea");
  attachFishingRod(hook, sea);
  resetFishingHook(false);
  speakNumber(arcade.target);
}

function fishingPointFromEvent(event, sea) {
  const box = sea.getBoundingClientRect();
  const x = Math.max(24, Math.min(box.width - 24, event.clientX - box.left));
  const y = Math.max(32, Math.min(box.height - 28, event.clientY - box.top));
  return { x, y, box };
}

function positionFishingHook(x, y) {
  const sea = screen.querySelector("#fishingSea");
  const hook = screen.querySelector("#fishingHook");
  const line = screen.querySelector("#rodLine");
  if (!sea || !hook || !line) return;

  hook.style.left = `${x}px`;
  hook.style.top = `${y}px`;

  const width = sea.clientWidth || 1;
  const height = sea.clientHeight || 1;
  line.setAttribute("x2", `${(x / width) * 100}%`);
  line.setAttribute("y2", `${(y / height) * 100}%`);
}

function resetFishingHook(animate = true) {
  const sea = screen.querySelector("#fishingSea");
  const hook = screen.querySelector("#fishingHook");
  if (!sea || !hook) return;
  hook.classList.toggle("hook-returning", animate);
  const x = sea.clientWidth * 0.78;
  const y = Math.max(72, sea.clientHeight * 0.22);
  positionFishingHook(x, y);
  if (animate) setTimeout(() => hook.classList.remove("hook-returning"), 360);
}

function attachFishingRod(hook, sea) {
  hook.addEventListener("pointerdown", event => {
    if (arcade.locked) return;
    event.preventDefault();
    hook.setPointerCapture(event.pointerId);
    const point = fishingPointFromEvent(event, sea);
    fishingDrag = { pointerId: event.pointerId };
    hook.classList.add("hook-dragging");
    positionFishingHook(point.x, point.y);
  });

  hook.addEventListener("pointermove", event => {
    if (!fishingDrag || fishingDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = fishingPointFromEvent(event, sea);
    positionFishingHook(point.x, point.y);
    highlightFishUnderHook();
  });

  const finish = event => {
    if (!fishingDrag || fishingDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    fishingDrag = null;
    hook.classList.remove("hook-dragging");
    tryCatchFish();
  };

  hook.addEventListener("pointerup", finish);
  hook.addEventListener("pointercancel", () => {
    fishingDrag = null;
    hook.classList.remove("hook-dragging");
    resetFishingHook();
  });
}

function fishUnderHook() {
  const hook = screen.querySelector("#fishingHook");
  if (!hook) return null;
  const h = hook.getBoundingClientRect();
  const hx = h.left + h.width / 2;
  const hy = h.top + h.height * 0.72;

  let best = null;
  let bestDistance = Infinity;
  screen.querySelectorAll(".number-fish").forEach(fish => {
    const f = fish.getBoundingClientRect();
    const fx = f.left + f.width / 2;
    const fy = f.top + f.height / 2;
    const distance = Math.hypot(hx - fx, hy - fy);
    const threshold = Math.max(56, Math.min(f.width, f.height) * 0.7);
    if (distance < threshold && distance < bestDistance) {
      best = fish;
      bestDistance = distance;
    }
  });
  return best;
}

function highlightFishUnderHook() {
  const hit = fishUnderHook();
  screen.querySelectorAll(".number-fish").forEach(fish => {
    fish.classList.toggle("hook-near", fish === hit);
  });
}

async function tryCatchFish() {
  if (arcade.locked) return;
  const fish = fishUnderHook();
  screen.querySelectorAll(".number-fish").forEach(f => f.classList.remove("hook-near"));

  if (!fish) {
    playTone(260, 0.08);
    resetFishingHook();
    return;
  }

  const n = Number(fish.dataset.number);
  if (n !== arcade.target) {
    fish.classList.add("wrong-fish");
    playTone(180, 0.16);
    await speakNumberNow(arcade.target);
    if (state.route === "fishing") resetFishingHook();
    return;
  }

  arcade.locked = true;
  const hook = screen.querySelector("#fishingHook");
  fish.classList.add("fish-on-hook");
  hook.classList.add("hook-catch");
  successChoice();
  await speakNumberNow(n);

  if (state.route !== "fishing") return;
  arcade.round++;
  if (arcade.round >= 5) {
    celebrate();
    showToast("איזה יופי! תפסתם את כל הדגים ⭐", "success");
    await sleep(650);
    if (state.route === "fishing") setRoute("home");
    return;
  }
  setTimeout(() => {
    if (state.route === "fishing") renderFishing();
  }, 700);
}

// ---------- Dino numbers: Google-Dino style runner ----------
function startDino() {
  dinoState.score = 0;
  dinoState.tokens = [];
  dinoState.running = true;
  dinoState.jumpActive = false;
  dinoState.lastTokenWasTarget = false;
  arcade.previousTarget = 0;
  pickDinoTarget();
  renderDino();
}

function pickDinoTarget() {
  const nums = numbersInRange();
  const candidates = nums.filter(n => n !== dinoState.target);
  dinoState.target = randomItem(candidates.length ? candidates : nums);
}

function renderDino() {
  screen.innerHTML = `
    <section class="mini-game dino-game">
      ${missionBar("🦖", "דינו המספרים", dinoState.target, `${dinoState.score}/5`)}
      <div class="dino-help"><span aria-hidden="true">☝️</span> הקישו כדי לקפוץ כשרואים את המספר הנכון</div>
      <div class="dino-course" id="dinoCourse" role="button" tabindex="0" aria-label="מסלול הדינוזאור. הקישו כדי לקפוץ">
        <div class="dino-clouds" aria-hidden="true">☁️ <span>☁️</span></div>
        <div class="dino-ground" aria-hidden="true"></div>
        <div class="dino-character" id="dinoCharacter" aria-hidden="true">🦖</div>
        <div class="dino-token-layer" id="dinoTokenLayer"></div>
        <div class="dino-jump-hint" aria-hidden="true">⬆</div>
      </div>
    </section>`;

  screen.querySelector("#dinoCourse").addEventListener("pointerdown", event => {
    event.preventDefault();
    dinoJump();
  });
  screen.querySelector("#dinoCourse").addEventListener("keydown", event => {
    if (event.code === "Space" || event.code === "ArrowUp") {
      event.preventDefault();
      dinoJump();
    }
  });

  dinoLastFrame = performance.now();
  dinoSpawnElapsed = 750;
  speakNumber(dinoState.target);
  dinoRaf = requestAnimationFrame(dinoLoop);
}

function dinoLoop(timestamp) {
  if (!dinoState.running || state.route !== "dino") return;

  const dt = Math.min(40, Math.max(0, timestamp - dinoLastFrame));
  dinoLastFrame = timestamp;
  dinoSpawnElapsed += dt;

  if (dinoSpawnElapsed >= 1450) {
    dinoSpawnElapsed = 0;
    spawnDinoNumber();
  }

  const course = screen.querySelector("#dinoCourse");
  if (!course) return;
  const width = course.clientWidth || 800;
  const speed = Math.max(0.16, width / 4300); // px per ms

  dinoState.tokens = dinoState.tokens.filter(token => {
    token.x -= speed * dt;
    token.el.style.left = `${token.x}px`;
    if (token.x < -90) {
      token.el.remove();
      return false;
    }
    return true;
  });

  dinoRaf = requestAnimationFrame(dinoLoop);
}

function spawnDinoNumber() {
  const layer = screen.querySelector("#dinoTokenLayer");
  const course = screen.querySelector("#dinoCourse");
  if (!layer || !course) return;

  const all = numbersInRange();
  let number;
  // Target appears often enough that a four-year-old never waits long.
  if (!dinoState.lastTokenWasTarget && Math.random() < 0.48) {
    number = dinoState.target;
    dinoState.lastTokenWasTarget = true;
  } else {
    const others = all.filter(n => n !== dinoState.target);
    number = randomItem(others.length ? others : all);
    dinoState.lastTokenWasTarget = number === dinoState.target;
  }

  const token = document.createElement("div");
  token.className = "dino-number-token";
  token.dataset.number = String(number);
  token.innerHTML = `<span>🥚</span><strong>${number}</strong>`;
  const x = course.clientWidth + 70;
  token.style.left = `${x}px`;
  layer.appendChild(token);
  dinoState.tokens.push({ el: token, number, x, processed: false });
}

function dinoJump() {
  if (!dinoState.running || state.route !== "dino" || dinoState.jumpActive) return;

  dinoState.jumpActive = true;
  const dino = screen.querySelector("#dinoCharacter");
  if (!dino) return;
  dino.classList.remove("dino-jump");
  void dino.offsetWidth;
  dino.classList.add("dino-jump");

  const course = screen.querySelector("#dinoCourse");
  const hitCenter = Math.max(105, course.clientWidth * 0.19);
  const hitRadius = Math.max(70, course.clientWidth * 0.075);

  let nearest = null;
  let distance = Infinity;
  dinoState.tokens.forEach(token => {
    if (token.processed) return;
    const d = Math.abs(token.x - hitCenter);
    if (d < hitRadius && d < distance) {
      nearest = token;
      distance = d;
    }
  });

  if (nearest) {
    nearest.processed = true;
    if (nearest.number === dinoState.target) {
      dinoCollectNumber(nearest);
    } else {
      nearest.el.classList.add("dino-wrong-token");
      playTone(180, 0.12);
      speakNumberNow(dinoState.target);
    }
  }

  clearTimeout(dinoJumpTimer);
  dinoJumpTimer = setTimeout(() => {
    dinoState.jumpActive = false;
    dino?.classList.remove("dino-jump");
  }, 570);
}

async function dinoCollectNumber(token) {
  token.el.classList.add("dino-collected");
  dinoState.score++;
  successChoice();
  await speakNumberNow(token.number);

  if (state.route !== "dino") return;
  if (dinoState.score >= 5) {
    dinoState.running = false;
    if (dinoRaf) cancelAnimationFrame(dinoRaf);
    dinoRaf = null;
    celebrate();
    showToast("דינו ניצח! 🏁", "success");
    setTimeout(() => {
      if (state.route === "dino") setRoute("home");
    }, 900);
    return;
  }

  pickDinoTarget();
  const mission = screen.querySelector(".big-mission strong");
  const score = screen.querySelector(".mini-score");
  if (mission) mission.textContent = dinoState.target;
  if (score) score.textContent = `${dinoState.score}/5`;
  speakNumber(dinoState.target);
}

// ---------- Rescue animals ----------
function startRescue() {
  arcade.round=0;
  renderRescue();
}

function renderRescue() {
  pickTarget();
  arcade.count=0; arcade.locked=false;
  screen.innerHTML=`
    <section class="mini-game rescue-game">
      ${missionBar("🐾", "רכבת ההצלה", arcade.target, `${arcade.round}/5`)}
      <div class="rescue-scene">
        <div class="rescue-train"><span>🚂</span><div class="rescue-wagon"><strong>${arcade.target}</strong><div id="rescuedAnimals" class="rescued-animals"></div></div></div>
        <div id="animalTray" class="animal-tray"></div>
      </div>
    </section>`;
  const animals=["🐶","🐱","🐰","🐼","🦊","🐨","🐵","🐯","🐷","🐮"];
  animals.slice(0,Math.min(10,arcade.target+3)).forEach(a=>{
    const b=document.createElement("button"); b.type="button"; b.className="animal-item"; b.textContent=a;
    b.addEventListener("click",()=>rescueAnimal(b,a));
    screen.querySelector("#animalTray").appendChild(b);
  });
  speakNumber(arcade.target);
}

async function rescueAnimal(button, animal) {
  if(arcade.locked||button.classList.contains("used"))return;
  button.classList.add("used");
  arcade.count++;
  const span=document.createElement("span"); span.textContent=animal;
  screen.querySelector("#rescuedAnimals").appendChild(span);
  playTone(420+arcade.count*25,.08);
  speakNumberNow(arcade.count);
  if(arcade.count>=arcade.target){
    arcade.locked=true; successChoice();
    nextArcadeRound("rescue",renderRescue,760);
  }
}

// ---------- Frog jumps / number order ----------
function startFrogJump() {
  arcade.round=0;
  arcade.step=1;
  renderFrogJump();
}

function renderFrogJump() {
  arcade.locked=false;
  screen.innerHTML=`
    <section class="mini-game frogjump-game">
      ${missionBar("🪷", "קפיצות הצפרדע", arcade.step, `${arcade.step-1}/${state.range}`)}
      <div class="lily-pond">
        <div id="lilyGrid" class="lily-grid"></div>
      </div>
    </section>`;
  const visualOrder = shuffle(numbersInRange());
  visualOrder.forEach(n=>{
    const b=document.createElement("button");
    b.type="button"; b.className="lily-pad"; b.dataset.number=n;
    b.innerHTML=`<strong>${n}</strong>`;
    b.addEventListener("click",()=>frogJumpTo(n,b));
    screen.querySelector("#lilyGrid").appendChild(b);
  });
  speakNumber(arcade.step);
}

async function frogJumpTo(n, pad) {
  if(arcade.locked)return;
  if(n!==arcade.step)return wrongChoice(pad);
  pad.classList.add("visited");
  screen.querySelectorAll(".little-frog").forEach(f => f.remove());
  pad.insertAdjacentHTML("beforeend",'<span class="little-frog hop">🐸</span>');
  successChoice();
  await speakNumberNow(n);
  if(n>=state.range){
    arcade.locked=true; celebrate();
    setTimeout(()=>setRoute("home"),850);
    return;
  }
  arcade.step++;
  const mission=screen.querySelector(".big-mission strong");
  if(mission) mission.textContent=arcade.step;
  speakNumber(arcade.step);
}

// ---------- Tower ----------
function startTower() {
  arcade.round=0;
  renderTower();
}

function renderTower() {
  pickTarget();
  arcade.count=0; arcade.locked=false;
  screen.innerHTML=`
    <section class="mini-game tower-game">
      ${missionBar("🧱", "בונים מגדל", arcade.target, `${arcade.round}/5`)}
      <div class="tower-scene">
        <div id="towerStack" class="tower-stack"></div>
        <button id="addBlockBtn" class="add-block-button" type="button"><span>🧱</span><strong>+</strong></button>
        <div id="towerCount" class="tower-count">0 / ${arcade.target}</div>
      </div>
    </section>`;
  screen.querySelector("#addBlockBtn").addEventListener("click",addTowerBlock);
  speakNumber(arcade.target);
}

async function addTowerBlock() {
  if(arcade.locked)return;
  arcade.count++;
  const block=document.createElement("div");
  block.className="tower-block";
  block.style.setProperty("--block-color",COLORS[(arcade.count-1)%COLORS.length]);
  block.textContent=arcade.count;
  screen.querySelector("#towerStack").appendChild(block);
  screen.querySelector("#towerCount").textContent=`${arcade.count} / ${arcade.target}`;
  playTone(400+arcade.count*35,.08);
  speakNumberNow(arcade.count);
  if(arcade.count>=arcade.target){
    arcade.locked=true; successChoice();
    nextArcadeRound("tower",renderTower,750);
  }
}

// ---------- Runaway number ----------
function startRunaway() {
  arcade.round=0;
  renderRunaway();
}

function renderRunaway() {
  pickTarget();
  arcade.locked=false;
  screen.innerHTML=`
    <section class="mini-game runaway-game">
      ${missionBar("💨", "המספר הבורח", arcade.target, `${arcade.round}/5`)}
      <div id="runawayArena" class="runaway-arena"></div>
    </section>`;
  choiceNumbers(arcade.target,4).forEach((n,i)=>{
    const b=document.createElement("button");
    b.type="button"; b.className="runaway-number"; b.dataset.number=n; b.textContent=n;
    b.addEventListener("click",async()=>{
      if(arcade.locked)return;
      if(n!==arcade.target)return wrongChoice(b);
      arcade.locked=true; b.classList.add("caught-runaway"); successChoice();
      clearInterval(arcadeTimer); arcadeTimer=null;
      await speakNumberNow(n); nextArcadeRound("runaway",renderRunaway,550);
    });
    screen.querySelector("#runawayArena").appendChild(b);
  });
  moveRunawayNumbers();
  arcadeTimer=setInterval(moveRunawayNumbers,900);
  speakNumber(arcade.target);
}

function moveRunawayNumbers() {
  const arena=screen.querySelector("#runawayArena");
  if(!arena)return;
  arena.querySelectorAll(".runaway-number").forEach((b,i)=>{
    const x=8+Math.random()*76;
    const y=8+Math.random()*70;
    b.style.left=`${x}%`; b.style.top=`${y}%`;
    b.style.transform=`translate(-50%,-50%) rotate(${Math.round(Math.random()*18-9)}deg)`;
  });
}

// ---------- Number race ----------
function startCatch() {
  state.catchRound = 0;
  state.catchScore = 0;
  state.catchTarget = 0;
  state.catchLocked = false;
  renderCatchRound();
}

function chooseCatchTarget() {
  const candidates = numbersInRange().filter(n => n !== state.catchTarget);
  return randomItem(candidates.length ? candidates : numbersInRange());
}

function raceChoices(target) {
  const all = shuffle(numbersInRange().filter(n => n !== target));
  const distractorCount = state.range >= 8 ? 3 : 2;
  return shuffle([target, ...all.slice(0, distractorCount)]);
}

function renderCatchRound() {
  screen.replaceChildren(cloneTemplate("catch-template"));
  state.catchLocked = true;
  state.catchTarget = chooseCatchTarget();

  const arena = screen.querySelector("#catchArena");
  const progress = screen.querySelector("#raceProgressFill");
  const car = screen.querySelector("#raceCar");
  const missionNumber = screen.querySelector("#raceMissionNumber");
  const pct = Math.min(100, (state.catchScore / 5) * 100);
  progress.style.width = `${pct}%`;
  car.style.left = `calc(${Math.min(88, 5 + pct * 0.83)}% - 24px)`;
  missionNumber.textContent = String(state.catchTarget);

  raceChoices(state.catchTarget).forEach((n, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "race-target";
    button.dataset.number = String(n);
    button.textContent = String(n);
    button.style.setProperty("--target-accent", COLORS[(n + index + state.catchRound) % COLORS.length]);
    button.setAttribute("aria-label", `המספר ${NUMBER_WORDS[n]}`);
    button.addEventListener("click", () => checkCatchNumber(n, button));
    arena.appendChild(button);
  });

  screen.querySelector("#repeatCatchBtn").addEventListener("click", () => announceCatchTarget(true));
  if (state.catchRound === 0) {
    runRaceCountdown();
  } else {
    setTimeout(announceCatchTarget, 280);
  }
}

async function runRaceCountdown() {
  const countdown = screen.querySelector("#raceCountdown");
  if (!countdown) {
    await announceCatchTarget();
    return;
  }
  state.catchLocked = true;
  const steps = [
    { visual: "3", number: 3 },
    { visual: "2", number: 2 },
    { visual: "1", number: 1 },
    { visual: "סע!", number: null }
  ];

  for (let index = 0; index < steps.length; index++) {
    if (!screen.contains(countdown) || state.route !== "catch") return;
    countdown.textContent = steps[index].visual;
    countdown.classList.remove("pop");
    void countdown.offsetWidth;
    countdown.classList.add("show", "pop");
    playTone(index < 3 ? 420 + index * 90 : 760, index < 3 ? 0.1 : 0.18);
    if (steps[index].number) await (index === 0 ? speakNumberNow(steps[index].number) : speakNumber(steps[index].number));
    else await sleep(260);
    await sleep(80);
  }

  if (!screen.contains(countdown) || state.route !== "catch") return;
  countdown.classList.remove("show");
  await sleep(120);
  await announceCatchTarget();
}

async function announceCatchTarget(isRepeat = false) {
  const repeatButton = screen.querySelector("#repeatCatchBtn");
  const mission = screen.querySelector(".race-mission");
  const targetAtStart = state.catchTarget;
  [repeatButton, mission].forEach(element => {
    if (!element) return;
    element.classList.remove("speaking");
    void element.offsetWidth;
    element.classList.add("speaking");
    setTimeout(() => element.classList.remove("speaking"), 850);
  });

  if (!isRepeat) state.catchLocked = true;
  const player = isRepeat ? speakNumberNow : speakNumber;
  await player(targetAtStart);
  if (!isRepeat && state.route === "catch" && state.catchTarget === targetAtStart) {
    state.catchLocked = false;
  }
}

function fireShot(button, correct) {
  const arena = screen.querySelector("#catchArena");
  const shot = document.createElement("span");
  shot.className = `race-shot ${correct ? "hit" : "miss"}`;
  shot.textContent = correct ? "💥" : "💨";
  const arenaBox = arena.getBoundingClientRect();
  const targetBox = button.getBoundingClientRect();
  shot.style.left = `${targetBox.left - arenaBox.left + targetBox.width / 2}px`;
  shot.style.top = `${targetBox.top - arenaBox.top + targetBox.height / 2}px`;
  arena.appendChild(shot);
  setTimeout(() => shot.remove(), 650);
}

async function checkCatchNumber(number, button) {
  if (state.catchLocked) return;

  if (number !== state.catchTarget) {
    fireShot(button, false);
    button.classList.remove("wrong-catch");
    void button.offsetWidth;
    button.classList.add("wrong-catch");
    playTone(185, 0.15);
    const feedback = screen.querySelector("#raceFeedback");
    if (feedback) feedback.textContent = "↻";
    await speakNumberNow(state.catchTarget);
    return;
  }

  state.catchLocked = true;
  fireShot(button, true);
  button.classList.add("caught");
  state.catchScore++;
  playTone(720, 0.14);
  celebrate();

  const progress = screen.querySelector("#raceProgressFill");
  const car = screen.querySelector("#raceCar");
  const pct = Math.min(100, (state.catchScore / 5) * 100);
  progress.style.width = `${pct}%`;
  car.style.left = `calc(${Math.min(88, 5 + pct * 0.83)}% - 24px)`;
  car.classList.remove("boost");
  void car.offsetWidth;
  car.classList.add("boost");
  setTimeout(() => car.classList.remove("boost"), 520);

  // Finish the success narration before creating the next mission.
  await speakNumberNow(number);
  if (state.route !== "catch") return;
  await sleep(140);

  state.catchRound++;
  if (state.catchRound >= 5) {
    car.textContent = "🏎️🏁";
    celebrate();
    await speak("כל הכבוד! הגעת לקו הסיום!");
    if (state.route !== "catch") return;
    await sleep(320);
    setRoute("home");
    return;
  }
  renderCatchRound();
}

// ---------- Number train ----------

function startTrain() {
  state.trainOrder = shuffle(numbersInRange());
  state.trainRound = 0;
  state.trainCounts = Object.fromEntries(numbersInRange().map(n => [n, 0]));
  state.trainLocked = false;
  renderTrain();
}

function currentTrainNumber() {
  return state.trainOrder[state.trainRound];
}

function trainInstructionText(n) {
  return `הכניסו ${ITEM_WORDS[n]} לקרון מספר ${n}`;
}

function renderTrain() {
  screen.replaceChildren(cloneTemplate("train-template"));
  const target = currentTrainNumber();
  const wagons = screen.querySelector("#wagons");
  const tray = screen.querySelector("#objectTray");
  wagons.style.gridTemplateColumns = `repeat(${state.range}, minmax(112px, 1fr))`;
  if (state.range > 6) wagons.style.minWidth = `${state.range * 118}px`;

  screen.querySelector("#trainInstruction").textContent = trainInstructionText(target);
  screen.querySelector("#roundCurrent").textContent = state.trainRound + 1;
  screen.querySelector("#roundTotal").textContent = state.trainOrder.length;
  screen.querySelector("#trayLabel").textContent = `גררו ${ITEM_WORDS[target]} לקרון ${target}`;

  numbersInRange().forEach(n => {
    const wagon = document.createElement("div");
    wagon.className = `wagon ${n === target ? "active-target" : ""}`.trim();
    wagon.dataset.number = String(n);
    wagon.style.setProperty("--wagon-color", COLORS[n - 1]);
    wagon.innerHTML = `<span class="wagon-number">${n}</span><div class="wagon-cargo" aria-label="פריטים בקרון ${n}"></div>`;
    const cargo = wagon.querySelector(".wagon-cargo");
    for (let i = 0; i < state.trainCounts[n]; i++) {
      const item = document.createElement("span");
      item.className = "cargo-item";
      item.textContent = ITEM;
      cargo.appendChild(item);
    }
    wagon.addEventListener("click", () => {
      const first = tray.querySelector(".drag-object:not(.used)");
      if (first && !state.trainLocked) addItemToWagon(n, first);
    });
    wagons.appendChild(wagon);
  });

  for (let i = 0; i < Math.max(target + 2, 5); i++) {
    const object = document.createElement("button");
    object.type = "button";
    object.className = "drag-object";
    object.textContent = ITEM;
    object.setAttribute("aria-label", "תפוח לגרירה");
    object.style.setProperty("--object-bg", LIGHT_COLORS[target - 1]);
    attachPointerDrag(object);
    object.addEventListener("click", event => {
      if (object.dataset.dragged === "true") {
        object.dataset.dragged = "false";
        event.preventDefault();
        return;
      }
      addItemToWagon(target, object);
    });
    tray.appendChild(object);
  }
  speakNumberNow(target);
  const repeatTrainBtn = screen.querySelector("#repeatTrainBtn");
  if (repeatTrainBtn) repeatTrainBtn.addEventListener("click", () => speakNumberNow(target));
}

function attachPointerDrag(object) {
  object.addEventListener("pointerdown", event => {
    if (state.trainLocked || object.classList.contains("used")) return;
    object.setPointerCapture(event.pointerId);
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = ITEM;
    ghost.style.fontSize = `${Math.max(72, object.getBoundingClientRect().width)}px`;
    document.body.appendChild(ghost);
    dragSession = {
      object,
      ghost,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    moveGhost(event.clientX, event.clientY);
  });

  object.addEventListener("pointermove", event => {
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - dragSession.startX, event.clientY - dragSession.startY) > 8) dragSession.moved = true;
    moveGhost(event.clientX, event.clientY);
  });

  const finish = event => {
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    const { object: source, ghost, moved } = dragSession;
    ghost.remove();
    dragSession = null;
    source.dataset.dragged = moved ? "true" : "false";
    if (!moved) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const wagon = hit?.closest?.(".wagon");
    if (wagon) addItemToWagon(Number(wagon.dataset.number), source);
  };

  object.addEventListener("pointerup", finish);
  object.addEventListener("pointercancel", finish);
}

function moveGhost(x, y) {
  if (!dragSession) return;
  dragSession.ghost.style.left = `${x}px`;
  dragSession.ghost.style.top = `${y}px`;
}

function addItemToWagon(wagonNumber, source) {
  if (state.trainLocked || source.classList.contains("used")) return;
  const target = currentTrainNumber();
  const wagon = screen.querySelector(`.wagon[data-number="${wagonNumber}"]`);
  if (wagonNumber !== target) {
    wagon?.classList.remove("wrong");
    void wagon?.offsetWidth;
    wagon?.classList.add("wrong");
    playTone(190, 0.18);
    showToast(`זה קרון ${wagonNumber}. חפשו את קרון ${target}`);
    speakNumberNow(target);
    return;
  }

  source.classList.add("used");
  state.trainCounts[target]++;
  const cargo = wagon.querySelector(".wagon-cargo");
  const item = document.createElement("span");
  item.className = "cargo-item";
  item.textContent = ITEM;
  cargo.appendChild(item);
  playTone(420 + state.trainCounts[target] * 35, 0.1);
  speakNumberNow(state.trainCounts[target]);
  if (state.trainCounts[target] === target) completeTrainRound(wagon, target);
}

async function completeTrainRound(wagon, target) {
  state.trainLocked = true;
  wagon.classList.remove("active-target");
  wagon.classList.add("correct");
  state.completedTrainRounds++;
  safeSet("numberTrainCompleted", String(state.completedTrainRounds));
  celebrate();
  showToast(`מצוין! בקרון ${target} יש ${ITEM_WORDS[target]} ⭐`, "success");

  // If the last apple was still being counted aloud, this sentence waits for it.
  await speakNumber(target);
  if (state.route !== "train") return;
  await sleep(180);

  state.trainRound++;
  if (state.trainRound >= state.trainOrder.length) {
    celebrate();
    const next = state.range < 10 ? state.range + 1 : null;
    showToast(next ? `סיימתם! כשתרצו אפשר לעלות ל־1–${next}` : "סיימתם את כל המספרים עד 10!", "success");
    await speak(next ? `איזה יופי! סיימתם את השלב. כשתרצו אפשר להוסיף את המספר ${NUMBER_WORDS[next]}.` : "איזה יופי! סיימתם את כל המספרים עד עשר.");
    if (state.route !== "train") return;
    await sleep(320);
    setRoute("home");
    return;
  }

  state.trainLocked = false;
  renderTrain();
}



if ("speechSynthesis" in window) {
  refreshHebrewVoice();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", refreshHebrewVoice);
  }
  setTimeout(refreshHebrewVoice, 250);
  setTimeout(refreshHebrewVoice, 1000);
  setTimeout(refreshHebrewVoice, 2500);
}

document.addEventListener("pointerdown", primeAudioFromGesture, { capture: true });
document.addEventListener("touchstart", primeAudioFromGesture, { capture: true, passive: true });

homeBtn.addEventListener("click", () => setRoute("home"));
soundBtn.addEventListener("click", () => {
  state.sound = !state.sound;
  safeSet("numberTrainSound", state.sound ? "on" : "off");
  soundBtn.textContent = state.sound ? "🔊" : "🔇";
  if (state.sound) {
    primeAudioFromGesture();
    speakNumberNow(1);
  } else {
    resetSpeechQueue();
  }
});
fullscreenBtn.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (_) {
    showToast("הדפדפן לא מאפשר כרגע מסך מלא");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearRouteTimers();
});

soundBtn.textContent = state.sound ? "🔊" : "🔇";
safeSet("numberTrainRange", String(state.range));
setRoute("home");
