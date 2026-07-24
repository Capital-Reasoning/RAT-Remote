"use strict";

const GATEWAY_ORIGIN = "https://crs-machines-mac-studio.taild8d202.ts.net";
const $ = (selector) => document.querySelector(selector);

const ui = {
  loginView: $("#loginView"),
  councilView: $("#councilView"),
  loginForm: $("#loginForm"),
  passwordInput: $("#passwordInput"),
  loginButton: $("#loginButton"),
  loginStatus: $("#loginStatus"),
  logoutButton: $("#logoutButton"),
  runtimeDot: $("#runtimeDot"),
  runtimeLabel: $("#runtimeLabel"),
  phaseTitle: $("#phaseTitle"),
  phaseBadge: $("#phaseBadge"),
  conversationLog: $("#conversationLog"),
  emptyConversation: $("#emptyConversation"),
  speechButton: $("#speechButton"),
  waveform: $("#waveformCanvas"),
  buttonLabel: $("#buttonLabel"),
  buttonHint: $("#buttonHint"),
  status: $("#statusMessage"),
  decisionPanel: $("#decisionPanel"),
  continueButton: $("#continueThinkingButton"),
  stopButton: $("#stopThinkingButton"),
  toast: $("#toast"),
};

const gateway = {
  bearer: "",
  authenticated: false,
};

const state = {
  sessionId: crypto.randomUUID(),
  phase: "locked",
  ready: false,
  holdActive: false,
  recording: false,
  audioContext: null,
  analyser: null,
  responseNode: null,
  responseResolve: null,
  microphoneStream: null,
  microphoneSource: null,
  processor: null,
  silentGain: null,
  chunks: [],
  captureMs: 0,
  inputLevel: 0,
  activeTurn: null,
  polling: null,
  playedAudio: new Set(),
  queuedAudio: new Set(),
  audioQueue: [],
  playingQueue: false,
  seenMessages: new Set(),
};

function toast(message, error = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", error);
  ui.toast.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove("visible"), 4200);
}

function setLoginStatus(message, error = false) {
  ui.loginStatus.textContent = message;
  ui.loginStatus.classList.toggle("error", error);
}

function gatewayHeaders(existing = {}) {
  const headers = new Headers(existing);
  if (gateway.bearer) headers.set("Authorization", `Bearer ${gateway.bearer}`);
  return headers;
}

async function gatewayFetch(path, options = {}) {
  if (!gateway.authenticated || !gateway.bearer) throw new Error("RAT is locked.");
  const response = await fetch(`${GATEWAY_ORIGIN}${path}`, {
    ...options,
    headers: gatewayHeaders(options.headers || {}),
  });
  if (response.status === 401) {
    lockCouncil(false);
    setLoginStatus("The session expired. Enter the password again.", true);
  }
  return response;
}

async function responseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) return response.json();
  return response.text();
}

async function api(path, options = {}) {
  const response = await gatewayFetch(path, options);
  const body = await responseBody(response);
  if (!response.ok) {
    const message = typeof body === "object" ? body.detail || body.error : body;
    throw new Error(message || `Request failed (${response.status})`);
  }
  return body;
}

async function login(event) {
  event.preventDefault();
  ui.loginButton.disabled = true;
  setLoginStatus("Waking the local council…");
  try {
    const response = await fetch(`${GATEWAY_ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ui.passwordInput.value }),
    });
    ui.passwordInput.value = "";
    const body = await responseBody(response);
    if (!response.ok) {
      const message = typeof body === "object" ? body.error || body.detail : body;
      throw new Error(message || `Login failed (${response.status}).`);
    }
    gateway.bearer = body.token;
    gateway.authenticated = true;
    state.sessionId = crypto.randomUUID();
    ui.loginView.hidden = true;
    ui.councilView.hidden = false;
    await warmVoice();
    ui.speechButton.focus({ preventScroll: true });
  } catch (error) {
    gateway.bearer = "";
    gateway.authenticated = false;
    ui.passwordInput.value = "";
    setLoginStatus(
      error instanceof TypeError
        ? "The secure gateway is offline. Try again shortly."
        : error.message || String(error),
      true,
    );
    ui.passwordInput.focus();
  } finally {
    ui.loginButton.disabled = false;
  }
}

async function lockCouncil(callGateway = true) {
  if (callGateway && gateway.authenticated) {
    try {
      await gatewayFetch("/api/auth/logout", { method: "POST" });
    } catch (_error) {
      // Locking this browser session remains authoritative.
    }
  }
  clearTimeout(state.polling);
  state.polling = null;
  state.holdActive = false;
  stopMicrophone();
  stopPlayback(true);
  gateway.bearer = "";
  gateway.authenticated = false;
  state.ready = false;
  state.activeTurn = null;
  state.phase = "locked";
  state.playedAudio.clear();
  state.queuedAudio.clear();
  state.seenMessages.clear();
  ui.conversationLog.querySelectorAll(".message").forEach((message) => message.remove());
  ui.emptyConversation.hidden = false;
  ui.runtimeDot.classList.remove("online");
  ui.runtimeLabel.textContent = "Locked";
  ui.councilView.hidden = true;
  ui.loginView.hidden = false;
  setLoginStatus("Secure gateway connection.");
  ui.passwordInput.value = "";
  ui.passwordInput.focus();
}

function activeDeepThought() {
  return ["queued", "running"].includes(state.activeTurn?.status);
}

function setPhase(phase, message = "") {
  state.phase = phase;
  const details = {
    waking: ["Preparing local speech", "WAKING"],
    ready: ["Ready when you are", "READY"],
    listening: ["Listening", "LISTENING"],
    routing: ["Talkie has answered", "ROUTING"],
    thinking: ["The council is considering it", "THINKING"],
    speaking: ["Speaking", "SPEAKING"],
    paused: ["Deeper consideration paused", "PAUSED"],
    error: ["Something needs attention", "ERROR"],
  };
  const [title, badge] = details[phase] || details.ready;
  ui.phaseTitle.textContent = title;
  ui.phaseBadge.textContent = badge;
  if (message) ui.status.textContent = message;
  updateButton();
}

function updateButton() {
  const paused = state.activeTurn?.status === "paused";
  const interruptible = activeDeepThought();
  ui.speechButton.disabled = !state.ready;
  ui.speechButton.classList.toggle("listening", state.holdActive);
  ui.speechButton.classList.toggle("interrupt", interruptible);
  ui.speechButton.setAttribute("aria-pressed", String(state.holdActive));
  if (!state.ready) {
    ui.buttonLabel.textContent = "Waking speech…";
    ui.buttonHint.textContent = "Connecting to the Mac Studio";
  } else if (state.holdActive) {
    ui.buttonLabel.textContent = "Release to send";
    ui.buttonHint.textContent = `${Math.max(0, state.captureMs / 1000).toFixed(1)} seconds`;
  } else if (interruptible) {
    ui.buttonLabel.textContent = "Tap to interrupt";
    ui.buttonHint.textContent = "Deeper consideration will pause";
  } else if (paused) {
    ui.buttonLabel.textContent = "Hold to answer";
    ui.buttonHint.textContent = "Say continue or stop";
  } else {
    ui.buttonLabel.textContent = "Hold to speak";
    ui.buttonHint.textContent = "Release when finished";
  }
  ui.speechButton.setAttribute(
    "aria-label",
    interruptible ? "Interrupt deeper consideration" : "Hold to speak",
  );
  ui.decisionPanel.hidden = !paused;
}

function appendMessage(key, role, label, text, kind = "") {
  if (!text || state.seenMessages.has(key)) return;
  state.seenMessages.add(key);
  ui.emptyConversation.hidden = true;
  const item = document.createElement("article");
  item.className = `message ${role} ${kind}`.trim();
  const heading = document.createElement("small");
  heading.textContent = label;
  const copy = document.createElement("p");
  copy.textContent = text;
  item.append(heading, copy);
  ui.conversationLog.append(item);
  ui.conversationLog.scrollTop = ui.conversationLog.scrollHeight;
}

function renderTurn(turn) {
  state.activeTurn = turn;
  appendMessage(`${turn.id}:user`, "user", "You", turn.transcript);
  for (const event of turn.events || []) {
    const labels = {
      backchannel: "Talkie · listening",
      immediate: "Talkie · immediate",
      progress: "Talkie · considering",
      final: "Talkie · final verbatim",
      decision: "Talkie",
      route: "Talkie · decision",
      cancelled: "Talkie",
      error: "Talkie",
    };
    const kind = event.kind === "final"
      ? "final"
      : ["backchannel", "progress"].includes(event.kind)
        ? event.kind
        : "";
    const chordName = event.voice_effect?.chord_name;
    const label = event.kind === "immediate" && chordName
      ? `${labels[event.kind]} · ${chordName}`
      : labels[event.kind] || event.kind;
    appendMessage(
      `${turn.id}:event:${event.id}`,
      "assistant",
      label,
      event.text,
      kind,
    );
    if (event.audio_url) {
      queueAudio(event.audio_url, event.playback_not_before_unix_ms || 0);
    }
  }
  if (turn.status === "paused") {
    setPhase("paused", "Answer by voice or choose below.");
  } else if (["queued", "running"].includes(turn.status)) {
    setPhase(
      "thinking",
      "I’m considering this more deeply. Tap once if you want to interrupt.",
    );
  } else if (turn.status === "routing") {
    setPhase("routing", "I’m deciding whether this needs deeper consideration.");
  } else if (turn.status === "error") {
    setPhase("error", turn.error || "The voice turn failed.");
  } else if (!state.playingQueue && !state.holdActive) {
    setPhase(
      "ready",
      turn.status === "cancelled"
        ? "The deeper consideration was stopped."
        : "Hold to speak again.",
    );
  }
}

async function ensureAudioContext() {
  if (!state.audioContext || state.audioContext.state === "closed") {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot run the speech interface.");
    state.audioContext = new AudioContextClass();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.analyser.smoothingTimeConstant = 0.72;
    state.analyser.connect(state.audioContext.destination);
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
}

function cloneSamples(samples) {
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return copy;
}

function rootMeanSquare(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function captureAudio(event) {
  if (!state.recording || !state.holdActive) return;
  const copy = cloneSamples(event.inputBuffer.getChannelData(0));
  state.chunks.push(copy);
  state.captureMs += (copy.length / state.audioContext.sampleRate) * 1000;
  state.inputLevel = state.inputLevel * 0.72 + rootMeanSquare(copy) * 0.28;
  updateButton();
}

function concatenateChunks(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resample(samples, sourceRate, targetRate = 16_000) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += samples[source];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function resetCapture() {
  state.chunks = [];
  state.captureMs = 0;
  state.inputLevel = 0;
}

function stopMicrophone() {
  state.recording = false;
  if (state.processor) state.processor.onaudioprocess = null;
  state.microphoneSource?.disconnect();
  state.processor?.disconnect();
  state.silentGain?.disconnect();
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.microphoneStream = null;
  state.microphoneSource = null;
  state.processor = null;
  state.silentGain = null;
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable.");
  }
  resetCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  if (!state.holdActive) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  state.microphoneStream = stream;
  state.microphoneSource = state.audioContext.createMediaStreamSource(stream);
  state.processor = state.audioContext.createScriptProcessor(2048, 1, 1);
  state.silentGain = state.audioContext.createGain();
  state.silentGain.gain.value = 0;
  state.processor.onaudioprocess = captureAudio;
  state.microphoneSource.connect(state.processor);
  state.processor.connect(state.silentGain);
  state.silentGain.connect(state.audioContext.destination);
  state.recording = true;
}

function stopPlayback(clearQueue = false) {
  if (clearQueue) state.audioQueue = [];
  const node = state.responseNode;
  const resolve = state.responseResolve;
  state.responseNode = null;
  state.responseResolve = null;
  if (node) {
    node.onended = null;
    try { node.stop(); } catch (_error) {}
    node.disconnect();
  }
  resolve?.(false);
}

function queueAudio(url, notBeforeUnixMs = 0) {
  if (!url || state.playedAudio.has(url) || state.queuedAudio.has(url)) return;
  state.queuedAudio.add(url);
  state.audioQueue.push({ url, notBeforeUnixMs });
  void playNextAudio();
}

async function playNextAudio() {
  if (state.playingQueue || state.holdActive || !state.audioQueue.length) return;
  state.playingQueue = true;
  const item = state.audioQueue.shift();
  const { url, notBeforeUnixMs } = item;
  try {
    await ensureAudioContext();
    const response = await gatewayFetch(url);
    if (!response.ok) throw new Error("Generated speech could not be loaded.");
    const decoded = await state.audioContext.decodeAudioData(await response.arrayBuffer());
    const remainingDelay = Math.max(0, notBeforeUnixMs - Date.now());
    if (remainingDelay) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }
    if (state.holdActive) return;
    stopPlayback();
    const node = state.audioContext.createBufferSource();
    node.buffer = decoded;
    node.connect(state.analyser);
    state.responseNode = node;
    setPhase("speaking", "Tap the circle to stop speech and pause deeper consideration.");
    await new Promise((resolve) => {
      state.responseResolve = resolve;
      node.onended = () => {
        if (state.responseNode === node) {
          state.responseNode = null;
          state.responseResolve = null;
          node.disconnect();
        }
        resolve(true);
      };
      node.start();
    });
    state.playedAudio.add(url);
  } catch (error) {
    toast(error.message || String(error), true);
  } finally {
    state.queuedAudio.delete(url);
    state.playingQueue = false;
    if (state.audioQueue.length) void playNextAudio();
    else if (!state.holdActive && state.activeTurn) renderTurn(state.activeTurn);
  }
}

async function interruptThought() {
  if (!activeDeepThought()) return;
  stopPlayback(true);
  try {
    const payload = await api(
      `/api/voice/turns/${state.activeTurn.id}/interrupt`,
      { method: "POST" },
    );
    renderTurn(payload.turn);
    if (payload.event?.audio_url) queueAudio(payload.event.audio_url);
  } catch (error) {
    toast(error.message || String(error), true);
  }
}

async function beginHold(event) {
  if (!state.ready || state.holdActive) return;
  event?.preventDefault();
  if (activeDeepThought()) {
    await interruptThought();
    return;
  }
  if (event?.pointerId !== undefined) {
    try { ui.speechButton.setPointerCapture(event.pointerId); } catch (_error) {}
  }
  state.holdActive = true;
  stopPlayback();
  setPhase("listening", "Release when you have finished.");
  try {
    await ensureAudioContext();
    if (state.holdActive) await startMicrophone();
  } catch (error) {
    state.holdActive = false;
    stopMicrophone();
    setPhase("error", error.message || String(error));
  }
}

async function endHold(event) {
  if (!state.holdActive) return;
  event?.preventDefault();
  state.holdActive = false;
  const chunks = state.chunks;
  const captureMs = state.captureMs;
  const sourceRate = state.audioContext?.sampleRate || 16_000;
  const wasRecording = state.recording;
  stopMicrophone();
  resetCapture();
  if (!wasRecording || captureMs < 250 || !chunks.length) {
    setPhase("ready", "Hold a little longer, then release.");
    return;
  }
  await sendUtterance(resample(concatenateChunks(chunks), sourceRate));
}

async function sendUtterance(samples) {
  ui.speechButton.disabled = true;
  setPhase("routing", "Transcribing locally, then asking Talkie…");
  try {
    const payload = await api(
      `/api/voice/utterances?session_id=${encodeURIComponent(state.sessionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: samples.buffer,
      },
    );
    renderTurn(payload.turn);
    if (payload.event?.audio_url) queueAudio(payload.event.audio_url);
    startPolling(payload.turn.id);
  } catch (error) {
    setPhase("error", `${error.message || error} Hold to try again.`);
  } finally {
    ui.speechButton.disabled = false;
    updateButton();
  }
}

function startPolling(turnId) {
  clearTimeout(state.polling);
  const poll = async () => {
    try {
      const payload = await api(`/api/voice/turns/${turnId}`);
      renderTurn(payload.turn);
      if (["routing", "queued", "running", "paused"].includes(payload.turn.status)) {
        state.polling = setTimeout(poll, 650);
      }
    } catch (error) {
      toast(error.message || String(error), true);
    }
  };
  state.polling = setTimeout(poll, 350);
}

async function decide(continueThinking) {
  if (!state.activeTurn) return;
  ui.continueButton.disabled = true;
  ui.stopButton.disabled = true;
  try {
    const payload = await api(`/api/voice/turns/${state.activeTurn.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ continue_thinking: continueThinking }),
    });
    renderTurn(payload.turn);
    if (payload.event?.audio_url) queueAudio(payload.event.audio_url);
    if (continueThinking) startPolling(payload.turn.id);
  } catch (error) {
    toast(error.message || String(error), true);
  } finally {
    ui.continueButton.disabled = false;
    ui.stopButton.disabled = false;
  }
}

function drawWaveform(time) {
  const canvas = ui.waveform;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const density = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * density));
  const height = Math.max(1, Math.floor(rect.height * density));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  const center = height / 2;
  const margin = width * 0.1;
  const span = width - margin * 2;
  const points = 150;
  let values = null;
  if (state.phase === "speaking" && state.analyser) {
    values = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(values);
  }
  context.beginPath();
  for (let index = 0; index < points; index += 1) {
    const progress = index / (points - 1);
    const envelope = Math.sin(Math.PI * progress) ** 0.75;
    let amplitude;
    if (values) {
      amplitude = ((values[Math.floor(progress * (values.length - 1))] - 128) / 128)
        * height * 0.34 * envelope;
    } else if (state.phase === "listening") {
      amplitude = Math.sin(progress * 25 + time / 115) * height
        * Math.max(0.025, Math.min(0.19, state.inputLevel * 3.8)) * envelope;
    } else if (["thinking", "routing"].includes(state.phase)) {
      amplitude = Math.sin(progress * 19 + time / 310) * height * 0.045 * envelope;
    } else {
      amplitude = Math.sin(progress * 9 + time / 850) * height * 0.009 * envelope;
    }
    const x = margin + progress * span;
    const y = center + amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.lineWidth = Math.max(1.2, density);
  context.lineCap = "round";
  context.strokeStyle = state.phase === "error"
    ? "rgba(255,139,128,.86)"
    : state.phase === "paused"
      ? "rgba(255,194,117,.9)"
      : ["listening", "speaking"].includes(state.phase)
        ? "rgba(216,255,114,.95)"
        : "rgba(236,233,223,.28)";
  context.stroke();
  window.requestAnimationFrame(drawWaveform);
}

async function warmVoice() {
  state.ready = false;
  setPhase("waking", "Connecting to the local speech runtime…");
  try {
    const status = await api("/api/voice/warm", { method: "POST" });
    state.ready = Boolean(status.ready);
    ui.runtimeDot.classList.toggle("online", state.ready);
    ui.runtimeLabel.textContent = state.ready ? "Speech ready" : "Speech unavailable";
    setPhase("ready", "Hold the circle and speak naturally.");
  } catch (error) {
    state.ready = false;
    ui.runtimeLabel.textContent = "Speech unavailable";
    setPhase("error", error.message || String(error));
  }
}

ui.loginForm.addEventListener("submit", login);
ui.logoutButton.addEventListener("click", () => lockCouncil());
ui.speechButton.addEventListener("pointerdown", beginHold);
ui.speechButton.addEventListener("pointerup", endHold);
ui.speechButton.addEventListener("pointercancel", endHold);
ui.speechButton.addEventListener("lostpointercapture", endHold);
ui.speechButton.addEventListener("contextmenu", (event) => event.preventDefault());
ui.continueButton.addEventListener("click", () => decide(true));
ui.stopButton.addEventListener("click", () => decide(false));
window.addEventListener("pointerup", endHold);
window.addEventListener("blur", () => {
  if (state.holdActive) void endHold();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && gateway.authenticated) {
    void lockCouncil();
    return;
  }
  if (
    [" ", "Enter"].includes(event.key)
    && document.activeElement === ui.speechButton
    && !event.repeat
  ) {
    void beginHold(event);
  }
});
window.addEventListener("keyup", (event) => {
  if ([" ", "Enter"].includes(event.key) && state.holdActive) void endHold(event);
});

window.requestAnimationFrame(drawWaveform);
