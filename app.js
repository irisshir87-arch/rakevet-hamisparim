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
let activeOnlineAudio = null;
let activeUtterance = null;
let activeSpeechCancel = null;
let speechMode = "unknown";
let speechSession = 0;
let speechQueue = Promise.resolve();

// Android / Samsung browsers block media until the first real user gesture.
// We unlock one persistent audio element on the first tap and reuse it for
// all online Hebrew narration afterwards.
const sharedOnlineAudio = new Audio();
sharedOnlineAudio.preload = "auto";
sharedOnlineAudio.playsInline = true;
const SILENT_AUDIO_SRC = "data:audio/wav;base64,UklGRiQFAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
let audioUnlocked = false;
let audioUnlockPromise = null;

function unlockAudioFromGesture() {
  if (audioUnlocked) return Promise.resolve(true);
  if (audioUnlockPromise) return audioUnlockPromise;

  refreshHebrewVoice();
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.resume(); } catch (_) {}
  }

  audioUnlockPromise = (async () => {
    try {
      sharedOnlineAudio.pause();
      sharedOnlineAudio.src = SILENT_AUDIO_SRC;
      sharedOnlineAudio.volume = 0.01;
      sharedOnlineAudio.currentTime = 0;
      const result = sharedOnlineAudio.play();
      if (result && typeof result.then === "function") await result;
      sharedOnlineAudio.pause();
      sharedOnlineAudio.currentTime = 0;
      sharedOnlineAudio.volume = 1;
      audioUnlocked = true;
      return true;
    } catch (_) {
      return false;
    } finally {
      audioUnlockPromise = null;
    }
  })();

  return audioUnlockPromise;
}

function refreshHebrewVoice() {
  hebrewVoice = null;
  if (!("speechSynthesis" in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    hebrewVoice = voices.find(v => {
      const lang = String(v.lang || "").toLowerCase().replace("_", "-");
      return lang === "he-il" || lang === "he" || lang.startsWith("he-") || lang.startsWith("iw-");
    }) || voices.find(v => /hebrew|עברית/i.test(String(v.name || ""))) || null;
    if (hebrewVoice) speechMode = "local-hebrew";
  } catch (_) {
    hebrewVoice = null;
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
      activeOnlineAudio.removeAttribute("src");
      activeOnlineAudio.load();
    } catch (_) {}
    activeOnlineAudio = null;
  }
}

function resetSpeechQueue() {
  speechSession++;
  stopActiveSpeech();
  speechQueue = Promise.resolve();
}

function onlineTtsUrls(text) {
  const encoded = encodeURIComponent(text);
  return [
    `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=he&q=${encoded}`,
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=he&q=${encoded}`
  ];
}

function playLocalHebrew(text, session) {
  return new Promise(resolve => {
    if (session !== speechSession || !state.sound || !hebrewVoice || !("speechSynthesis" in window)) {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
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
      utterance.voice = hebrewVoice;
      utterance.rate = 0.82;
      utterance.pitch = 1.04;
      utterance.volume = 1;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      activeUtterance = utterance;
      activeSpeechCancel = cancelPlayback;
      window.speechSynthesis.speak(utterance);
      speechMode = "local-hebrew";
    } catch (_) {
      finish(false);
    }
  });
}

async function playOnlineHebrew(text, session, urlIndex = 0) {
  const urls = onlineTtsUrls(text);
  if (session !== speechSession || !state.sound || urlIndex >= urls.length) {
    return false;
  }

  // Wait briefly for the first-tap unlock when Android requires it.
  if (audioUnlockPromise) {
    try { await audioUnlockPromise; } catch (_) {}
  }

  return new Promise(resolve => {
    let settled = false;
    const audio = sharedOnlineAudio;

    const cleanup = () => {
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
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
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
      activeOnlineAudio = audio;
      activeSpeechCancel = cancelPlayback;
      audio.preload = "auto";
      audio.volume = 1;
      audio.src = urls[urlIndex];
      audio.onplaying = () => { speechMode = "online-hebrew"; };
      audio.onended = () => finish(true);
      audio.onerror = tryNext;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          // If Android still blocks playback, keep the game usable and
          // let the next tap unlock audio before retrying.
          audioUnlocked = false;
          tryNext();
        });
      }
    } catch (_) {
      audioUnlocked = false;
      tryNext();
    }
  });
}

async function playHebrewSpeech(text, session) {
  refreshHebrewVoice();
  if (hebrewVoice) {
    const played = await playLocalHebrew(text, session);
    if (played || session !== speechSession || !state.sound) return played;
  }
  return playOnlineHebrew(text, session);
}

function primeSpeech() {
  if (!state.sound) return;
  refreshHebrewVoice();
  if (hebrewVoice && "speechSynthesis" in window) {
    try { window.speechSynthesis.resume(); } catch (_) {}
  }
}

function handleFirstAudioGesture() {
  if (!state.sound) return;
  primeSpeech();
  unlockAudioFromGesture();
}

// All narration goes through one queue. A new task never starts speaking
// over the feedback from the task that just ended.
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

// Used for manual repeat / immediate corrective feedback: clear stale queued
// narration first, then play only the requested sentence.
function speakNow(text) {
  resetSpeechQueue();
  return speak(text);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function playTone(frequency = 540, duration = 0.16) {
  if (!state.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
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
    oscillator.addEventListener("ended", () => ctx.close());
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

function clearRouteTimers() {
  clearInterval(catchMoveTimer);
  catchMoveTimer = null;
  resetSpeechQueue();
}

function setRoute(route) {
  clearRouteTimers();
  state.route = route;
  homeBtn.classList.toggle("hidden", route === "home");
  screen.replaceChildren();
  if (route === "home") renderHome();
  if (route === "catch") startCatch();
  if (route === "train") startTrain();
  if (route === "missing") renderMissing(true);
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
      speak(`שלב אחד עד ${NUMBER_WORDS[state.range]}`);
    });
  });
  const progress = screen.querySelector("#homeProgress");
  progress.textContent = `מתחילים ב־1–5 • מוסיפים מספר אחד בכל שלב`;
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
    { visual: "3", spoken: "שלוש" },
    { visual: "2", spoken: "שתיים" },
    { visual: "1", spoken: "אחת" },
    { visual: "סע!", spoken: "סע" }
  ];

  for (let index = 0; index < steps.length; index++) {
    if (!screen.contains(countdown) || state.route !== "catch") return;
    countdown.textContent = steps[index].visual;
    countdown.classList.remove("pop");
    void countdown.offsetWidth;
    countdown.classList.add("show", "pop");
    playTone(index < 3 ? 420 + index * 90 : 760, index < 3 ? 0.1 : 0.18);
    await speak(steps[index].spoken);
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
  const player = isRepeat ? speakNow : speak;
  await player(`לחץ על המספר ${NUMBER_WORDS[targetAtStart]}`);
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
    await speakNow(`נסה שוב. לחץ על המספר ${NUMBER_WORDS[state.catchTarget]}`);
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
  await speak(`כל הכבוד! ${NUMBER_WORDS[number]}`);
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
  speak(trainInstructionText(target));
  const repeatTrainBtn = screen.querySelector("#repeatTrainBtn");
  if (repeatTrainBtn) repeatTrainBtn.addEventListener("click", () => speakNow(trainInstructionText(target)));
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
    speak(`זה קרון ${NUMBER_WORDS[wagonNumber]}. חפשו את קרון ${NUMBER_WORDS[target]}.`);
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
  speak(COUNT_WORDS[state.trainCounts[target]]);
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
  await speak(`כל הכבוד! זה המספר ${NUMBER_WORDS[target]}. בקרון יש ${ITEM_WORDS[target]}.`);
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

// ---------- Missing number ----------
function renderMissing(newRound = false) {
  screen.replaceChildren(cloneTemplate("missing-template"));
  if (newRound) state.missingNumber = randomItem(numbersInRange());
  screen.querySelector("#missingScore").textContent = state.missingScore;
  const train = screen.querySelector("#missingTrain");
  const choices = screen.querySelector("#answerChoices");
  if (state.range > 6) train.classList.add("wide-sequence");

  numbersInRange().forEach(n => {
    const car = document.createElement("div");
    car.className = `missing-car ${n === state.missingNumber ? "blank" : ""}`.trim();
    car.style.setProperty("--wagon-color", COLORS[n - 1]);
    car.textContent = n === state.missingNumber ? "?" : String(n);
    train.appendChild(car);
  });

  const distractors = numbersInRange().filter(n => n !== state.missingNumber);
  const values = shuffle([state.missingNumber, ...shuffle(distractors).slice(0, 2)]);
  values.forEach(n => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-button";
    button.textContent = n;
    button.addEventListener("click", () => checkMissingAnswer(n, button));
    choices.appendChild(button);
  });
  speak("איזה מספר חסר ברכבת?");
  const repeatMissingBtn = screen.querySelector("#repeatMissingBtn");
  if (repeatMissingBtn) repeatMissingBtn.addEventListener("click", () => speakNow("איזה מספר חסר ברכבת?"));
}

async function checkMissingAnswer(number, button) {
  if (button.parentElement?.dataset.locked === "true") return;
  if (number === state.missingNumber) {
    button.parentElement.dataset.locked = "true";
    button.classList.add("right");
    state.missingScore++;
    safeSet("numberTrainMissingScore", String(state.missingScore));
    celebrate();
    showToast(`נכון! המספר החסר הוא ${number}`, "success");
    await speak(`נכון מאוד! המספר החסר הוא ${NUMBER_WORDS[number]}.`);
    if (state.route !== "missing") return;
    await sleep(160);
    renderMissing(true);
  } else {
    button.classList.remove("nope");
    void button.offsetWidth;
    button.classList.add("nope");
    playTone(180, 0.18);
    showToast("כמעט, נסו מספר אחר");
    await speakNow("כמעט. נסו מספר אחר.");
  }
}

if ("speechSynthesis" in window) {
  refreshHebrewVoice();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", refreshHebrewVoice);
  }
}
document.addEventListener("pointerdown", handleFirstAudioGesture, { capture: true });
document.addEventListener("touchstart", handleFirstAudioGesture, { capture: true, passive: true });

homeBtn.addEventListener("click", () => setRoute("home"));
soundBtn.addEventListener("click", () => {
  state.sound = !state.sound;
  safeSet("numberTrainSound", state.sound ? "on" : "off");
  soundBtn.textContent = state.sound ? "🔊" : "🔇";
  if (state.sound) {
    primeSpeech();
    unlockAudioFromGesture().finally(() => {
      speakNow("שלום אלון, הקול עובד בעברית");
    });
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
