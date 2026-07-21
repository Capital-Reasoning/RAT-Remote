const ui = {
  app: document.querySelector("#app"),
  unlockView: document.querySelector("#unlockView"),
  conversationView: document.querySelector("#conversationView"),
  gatewayLoginForm: document.querySelector("#gatewayLoginForm"),
  gatewayUrl: document.querySelector("#gatewayUrl"),
  gatewayPassword: document.querySelector("#gatewayPassword"),
  gatewayLoginButton: document.querySelector("#gatewayLoginButton"),
  gatewayStatus: document.querySelector("#gatewayStatus"),
  waveformSurface: document.querySelector("#waveformSurface"),
  waveformCanvas: document.querySelector("#waveformCanvas"),
  waveformAction: document.querySelector("#waveformAction"),
  conversationStatus: document.querySelector("#conversationStatus"),
  conversationMessage: document.querySelector("#conversationMessage"),
  textComposer: document.querySelector("#textComposer"),
  textInput: document.querySelector("#textInput"),
  responseAudio: document.querySelector("#responseAudio"),
};

const gateway = {
  apiBase: "",
  bearer: "",
  authenticated: false,
};

const state = {
  phase: "locked",
  projectId: "",
  audioContext: null,
  responseSource: null,
  analyser: null,
  microphoneStream: null,
  microphoneSource: null,
  processor: null,
  silentGain: null,
  listening: false,
  speaking: false,
  speechFrames: 0,
  silenceMs: 0,
  captureMs: 0,
  noiseFloor: 0.004,
  preRoll: [],
  preRollMs: 0,
  utterance: [],
  inputLevel: 0,
  processing: false,
  queuedUtterance: null,
  responseObjectUrl: "",
  playbackBlocked: false,
  animationFrame: 0,
};

function normalizeGatewayUrl(value) {
  const url = new URL(value);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("The endpoint must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Keep credentials out of the endpoint URL.");
  }
  return url.origin;
}

function setUnlockStatus(message, status = "quiet") {
  ui.gatewayStatus.textContent = message;
  ui.gatewayStatus.dataset.state = status;
}

function setConversationMessage(message = "", status = "quiet") {
  ui.conversationMessage.textContent = message;
  ui.conversationMessage.dataset.state = status;
}

function setPhase(phase, message = "") {
  state.phase = phase;
  ui.app.dataset.mode = phase;
  const labels = {
    waking: "waking",
    listening: "listening",
    hearing: "hearing",
    thinking: "thinking",
    speaking: "speaking",
    paused: "paused",
    error: "try again",
  };
  ui.conversationStatus.textContent = labels[phase] || phase;
  if (message) setConversationMessage(message, phase === "error" ? "error" : "quiet");
  ui.waveformSurface.setAttribute(
    "aria-label",
    state.listening ? "Pause listening" : "Resume listening",
  );
  ui.waveformAction.textContent = state.listening ? "Pause listening" : "Resume listening";
}

function gatewayHeaders(existing = {}) {
  const headers = new Headers(existing);
  if (gateway.bearer) headers.set("Authorization", `Bearer ${gateway.bearer}`);
  return headers;
}

async function gatewayFetch(path, options = {}) {
  if (!gateway.authenticated || !gateway.apiBase) {
    throw new Error("RAT is locked.");
  }
  const response = await fetch(`${gateway.apiBase}${path}`, {
    ...options,
    headers: gatewayHeaders(options.headers || {}),
  });
  if (response.status === 401) {
    await lockConversation(false);
    setUnlockStatus("The session expired. Enter the password again.", "error");
  }
  return response;
}

async function responseError(response, fallback) {
  const text = (await response.text()).trim();
  try {
    return JSON.parse(text).error || text || fallback;
  } catch (_error) {
    return text || fallback;
  }
}

async function selectConversationProject() {
  const response = await gatewayFetch("/api/projects");
  if (!response.ok) throw new Error(await responseError(response, "Could not load a conversation."));
  const projects = (await response.json()).projects || [];
  let projectId = projects[0]?.id || "";

  if (!projectId) {
    const created = await gatewayFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Voice conversation",
        initial_idea: "",
        data_policy: "LOCAL_ONLY",
      }),
    });
    if (!created.ok) throw new Error(await responseError(created, "Could not begin a conversation."));
    projectId = (await created.json()).project.id;
  }

  const selected = await gatewayFetch(`/api/projects/${encodeURIComponent(projectId)}/select`, {
    method: "POST",
  });
  if (!selected.ok) throw new Error(await responseError(selected, "Could not select the conversation."));
  state.projectId = projectId;
}

async function loginGateway(event) {
  event.preventDefault();
  ui.gatewayLoginButton.disabled = true;
  setUnlockStatus("Waking the local model…");
  try {
    const apiBase = normalizeGatewayUrl(ui.gatewayUrl.value.trim());
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ui.gatewayPassword.value }),
    });
    ui.gatewayPassword.value = "";
    if (!response.ok) {
      throw new Error(await responseError(response, `Login failed (${response.status}).`));
    }
    const payload = await response.json();
    gateway.apiBase = apiBase;
    gateway.bearer = payload.token;
    gateway.authenticated = true;
    ui.unlockView.hidden = true;
    ui.conversationView.hidden = false;
    setPhase("waking");
    await selectConversationProject();
    await startMicrophone();
  } catch (error) {
    ui.gatewayPassword.value = "";
    if (!gateway.authenticated) {
      ui.unlockView.hidden = false;
      ui.conversationView.hidden = true;
      ui.gatewayLoginButton.disabled = false;
      const message = error instanceof TypeError
        ? "The gateway could not be reached. Check the endpoint and try again."
        : error.message || String(error);
      setUnlockStatus(message, "error");
      return;
    }
    setPhase("error", `${error.message || error} Tap the waveform to retry.`);
  }
}

async function ensureAudioContext() {
  if (!state.audioContext || state.audioContext.state === "closed") {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot run the voice interface.");
    state.audioContext = new AudioContextClass();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.analyser.smoothingTimeConstant = 0.72;
    state.responseSource = state.audioContext.createMediaElementSource(ui.responseAudio);
    state.responseSource.connect(state.analyser);
    state.analyser.connect(state.audioContext.destination);
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
}

function resetCapture() {
  state.speaking = false;
  state.speechFrames = 0;
  state.silenceMs = 0;
  state.captureMs = 0;
  state.preRoll = [];
  state.preRollMs = 0;
  state.utterance = [];
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
  if (!state.listening) return;
  const samples = event.inputBuffer.getChannelData(0);
  const copy = cloneSamples(samples);
  const frameMs = (copy.length / state.audioContext.sampleRate) * 1000;
  const level = rootMeanSquare(copy);
  state.inputLevel = state.inputLevel * 0.72 + level * 0.28;
  const threshold = Math.max(0.012, state.noiseFloor * 3.2);
  const voiced = level > threshold;

  if (!state.speaking) {
    if (!voiced) state.noiseFloor = state.noiseFloor * 0.97 + level * 0.03;
    state.preRoll.push(copy);
    state.preRollMs += frameMs;
    while (state.preRollMs > 320 && state.preRoll.length > 1) {
      const removed = state.preRoll.shift();
      state.preRollMs -= (removed.length / state.audioContext.sampleRate) * 1000;
    }
    state.speechFrames = voiced ? state.speechFrames + 1 : 0;
    if (state.speechFrames >= 2) {
      state.speaking = true;
      state.utterance = [...state.preRoll];
      state.captureMs = state.preRollMs;
      state.silenceMs = 0;
      stopPlayback();
      setPhase("hearing");
    }
    return;
  }

  state.utterance.push(copy);
  state.captureMs += frameMs;
  state.silenceMs = voiced ? 0 : state.silenceMs + frameMs;
  if ((state.silenceMs >= 720 && state.captureMs >= 320) || state.captureMs >= 24_000) {
    finishUtterance();
  }
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

function finishUtterance() {
  const chunks = state.utterance;
  const sourceRate = state.audioContext.sampleRate;
  resetCapture();
  const utterance = resample(concatenateChunks(chunks), sourceRate);
  if (utterance.length < 16_000 * 0.25) {
    setPhase("listening");
    return;
  }
  queueUtterance(utterance);
}

function queueUtterance(samples) {
  if (state.processing) {
    state.queuedUtterance = samples;
    return;
  }
  sendUtterance(samples);
}

function decodeBase64Audio(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "audio/wav" });
}

function releaseResponseUrl() {
  if (!state.responseObjectUrl) return;
  URL.revokeObjectURL(state.responseObjectUrl);
  state.responseObjectUrl = "";
}

function stopPlayback() {
  state.playbackBlocked = false;
  ui.responseAudio.pause();
  if (!ui.responseAudio.ended) ui.responseAudio.currentTime = 0;
}

async function playAudio(blob) {
  releaseResponseUrl();
  state.responseObjectUrl = URL.createObjectURL(blob);
  ui.responseAudio.src = state.responseObjectUrl;
  await ensureAudioContext();
  setPhase("speaking");
  try {
    await ui.responseAudio.play();
    state.playbackBlocked = false;
  } catch (_error) {
    state.playbackBlocked = true;
    setPhase("paused", "Tap the waveform to hear the response.");
  }
}

async function sendUtterance(samples) {
  state.processing = true;
  setPhase("thinking");
  try {
    const response = await gatewayFetch("/api/converse", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: samples.buffer,
    });
    if (!response.ok) throw new Error(await responseError(response, "RAT did not understand that."));
    const payload = await response.json();
    ui.conversationMessage.textContent = payload.response || "";
    if (payload.audio_wav) {
      await playAudio(decodeBase64Audio(payload.audio_wav));
    } else {
      setPhase("listening");
    }
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes("No speech detected")) {
      setPhase("listening");
      setConversationMessage("");
    } else {
      setPhase("error", `${message} Tap the waveform to continue.`);
    }
  } finally {
    state.processing = false;
    if (state.queuedUtterance) {
      const queued = state.queuedUtterance;
      state.queuedUtterance = null;
      stopPlayback();
      sendUtterance(queued);
    }
  }
}

async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable in this browser.");
  }
  if (state.listening) return;
  await ensureAudioContext();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  state.microphoneStream = stream;
  state.microphoneSource = state.audioContext.createMediaStreamSource(stream);
  state.processor = state.audioContext.createScriptProcessor(2048, 1, 1);
  state.silentGain = state.audioContext.createGain();
  state.silentGain.gain.value = 0;
  state.processor.onaudioprocess = captureAudio;
  state.microphoneSource.connect(state.processor);
  state.processor.connect(state.silentGain);
  state.silentGain.connect(state.audioContext.destination);
  state.listening = true;
  resetCapture();
  setConversationMessage("");
  setPhase("listening");
  ui.waveformSurface.focus({ preventScroll: true });
}

function stopMicrophone() {
  state.listening = false;
  if (state.processor) state.processor.onaudioprocess = null;
  state.microphoneSource?.disconnect();
  state.processor?.disconnect();
  state.silentGain?.disconnect();
  state.microphoneStream?.getTracks().forEach((track) => track.stop());
  state.microphoneStream = null;
  state.microphoneSource = null;
  state.processor = null;
  state.silentGain = null;
  resetCapture();
  setPhase("paused");
}

async function toggleListening() {
  if (!gateway.authenticated) return;
  if (state.playbackBlocked) {
    try {
      await ensureAudioContext();
      await ui.responseAudio.play();
      state.playbackBlocked = false;
      setConversationMessage("");
    } catch (_error) {
      setPhase("error", "Audio playback is blocked by this browser.");
    }
    return;
  }
  if (!ui.responseAudio.paused && state.phase === "speaking") {
    stopPlayback();
    setPhase(state.listening ? "listening" : "paused");
    return;
  }
  if (ui.responseAudio.src && state.phase === "paused" && !state.listening) {
    await startMicrophone();
    return;
  }
  if (state.listening) {
    stopMicrophone();
  } else {
    try {
      await startMicrophone();
    } catch (error) {
      setPhase("error", `${error.message || error} Tap to retry.`);
    }
  }
}

async function speakText(text) {
  const response = await gatewayFetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(await responseError(response, "Speech synthesis failed."));
  await playAudio(await response.blob());
}

async function submitText(event) {
  event.preventDefault();
  const text = ui.textInput.value.trim();
  if (!text || !state.projectId || state.processing) return;
  ui.textInput.value = "";
  ui.textComposer.hidden = true;
  state.processing = true;
  setPhase("thinking");
  try {
    const response = await gatewayFetch(
      `/api/projects/${encodeURIComponent(state.projectId)}/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    if (!response.ok) throw new Error(await responseError(response, "RAT could not respond."));
    const turn = await response.json();
    ui.conversationMessage.textContent = turn.spoken_response || "";
    await speakText(turn.spoken_response);
  } catch (error) {
    setPhase("error", error.message || String(error));
  } finally {
    state.processing = false;
  }
}

async function lockConversation(callGateway = true) {
  if (callGateway && gateway.authenticated) {
    try {
      await gatewayFetch("/api/auth/logout", { method: "POST" });
    } catch (_error) {
      // Local lock remains authoritative when the gateway cannot be reached.
    }
  }
  stopMicrophone();
  stopPlayback();
  gateway.bearer = "";
  gateway.authenticated = false;
  state.projectId = "";
  state.phase = "locked";
  ui.app.dataset.mode = "locked";
  ui.conversationView.hidden = true;
  ui.unlockView.hidden = false;
  ui.gatewayLoginButton.disabled = false;
  setUnlockStatus("Nothing leaves your chosen gateway.");
  ui.gatewayPassword.focus();
}

function drawWaveform(time) {
  const canvas = ui.waveformCanvas;
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
  const margin = width * 0.14;
  const span = width - margin * 2;
  const points = 192;
  let values = null;
  if (state.phase === "speaking" && state.analyser) {
    values = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(values);
  }

  context.beginPath();
  for (let index = 0; index < points; index += 1) {
    const progress = index / (points - 1);
    const envelope = Math.sin(Math.PI * progress) ** 0.7;
    let amplitude = 0;
    if (values) {
      const sample = values[Math.floor(progress * (values.length - 1))];
      amplitude = ((sample - 128) / 128) * height * 0.38 * envelope;
    } else if (state.phase === "thinking") {
      amplitude = Math.sin(progress * 18 + time / 360) * height * 0.045 * envelope;
    } else if (state.phase === "hearing") {
      amplitude = Math.sin(progress * 24 + time / 120) * height
        * Math.min(0.12, state.inputLevel * 3.5) * envelope;
    } else {
      amplitude = Math.sin(progress * 8 + time / 900) * height * 0.007 * envelope;
    }
    const x = margin + progress * span;
    const y = center + amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.lineWidth = Math.max(1.25, density * 0.9);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = state.phase === "error"
    ? "rgba(255, 118, 95, 0.82)"
    : state.phase === "speaking"
      ? "rgba(183, 255, 90, 0.96)"
      : "rgba(236, 233, 223, 0.34)";
  context.shadowBlur = state.phase === "speaking" ? 20 * density : 0;
  context.shadowColor = "rgba(183, 255, 90, 0.4)";
  context.stroke();
  state.animationFrame = window.requestAnimationFrame(drawWaveform);
}

ui.gatewayLoginForm.addEventListener("submit", loginGateway);
ui.waveformSurface.addEventListener("click", toggleListening);
ui.textComposer.addEventListener("submit", submitText);
ui.responseAudio.addEventListener("ended", () => {
  state.playbackBlocked = false;
  releaseResponseUrl();
  if (!state.processing) setPhase(state.listening ? "listening" : "paused");
});
ui.responseAudio.addEventListener("play", () => setPhase("speaking"));

window.addEventListener("keydown", (event) => {
  if (!gateway.authenticated) return;
  if (event.key === "Escape") {
    if (!ui.textComposer.hidden) {
      ui.textComposer.hidden = true;
      ui.textInput.value = "";
      ui.waveformSurface.focus();
    } else {
      lockConversation();
    }
    return;
  }
  if (event.key === "/" && ui.textComposer.hidden && document.activeElement === ui.waveformSurface) {
    event.preventDefault();
    ui.textComposer.hidden = false;
    ui.textInput.focus();
  }
});

const suggestedGateway = location.protocol === "https:" && location.hostname.endsWith("github.io")
  ? ""
  : location.origin;
ui.gatewayUrl.value = suggestedGateway;
state.animationFrame = window.requestAnimationFrame(drawWaveform);
