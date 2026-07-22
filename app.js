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
  holdLabel: document.querySelector("#holdLabel"),
  conversationStatus: document.querySelector("#conversationStatus"),
  conversationMessage: document.querySelector("#conversationMessage"),
  textComposer: document.querySelector("#textComposer"),
  textInput: document.querySelector("#textInput"),
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
  analyser: null,
  responseNode: null,
  responseResolve: null,
  microphoneStream: null,
  microphoneSource: null,
  processor: null,
  silentGain: null,
  holdActive: false,
  recording: false,
  captureMs: 0,
  utterance: [],
  inputLevel: 0,
  processing: false,
  requestController: null,
  requestSerial: 0,
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
    ready: "ready",
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
    error: "try again",
  };
  ui.conversationStatus.textContent = labels[phase] || phase;
  if (message) setConversationMessage(message, phase === "error" ? "error" : "quiet");
  const action = state.holdActive ? "Release to send" : "Hold to speak";
  ui.waveformSurface.setAttribute("aria-label", action);
  ui.waveformSurface.setAttribute("aria-pressed", String(state.holdActive));
  ui.waveformAction.textContent = action;
  ui.holdLabel.textContent = action;
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
  const body = (await response.text()).trim();
  try {
    return JSON.parse(body).error || body || fallback;
  } catch (_error) {
    return body || fallback;
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
    setConversationMessage("");
    setPhase("ready");
    ui.waveformSurface.focus({ preventScroll: true });
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
    setPhase("error", `${error.message || error} Hold to retry.`);
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
    state.analyser.connect(state.audioContext.destination);
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
}

function resetCapture() {
  state.captureMs = 0;
  state.utterance = [];
  state.inputLevel = 0;
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
  state.utterance.push(copy);
  state.captureMs += (copy.length / state.audioContext.sampleRate) * 1000;
  const level = rootMeanSquare(copy);
  state.inputLevel = state.inputLevel * 0.72 + level * 0.28;
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
    throw new Error("Microphone access is unavailable in this browser.");
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

function cancelCurrentResponse() {
  state.requestSerial += 1;
  state.requestController?.abort();
  state.requestController = null;
  state.processing = false;
}

function stopPlayback() {
  const node = state.responseNode;
  const resolve = state.responseResolve;
  state.responseNode = null;
  state.responseResolve = null;
  if (!node) {
    resolve?.(false);
    return;
  }
  node.onended = null;
  try {
    node.stop();
  } catch (_error) {
    // The source may already have ended.
  }
  node.disconnect();
  resolve?.(false);
}

async function beginHold(event) {
  if (!gateway.authenticated || state.holdActive) return;
  event?.preventDefault();
  if (event?.pointerId !== undefined) {
    try {
      ui.waveformSurface.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional; global release listeners remain active.
    }
  }
  state.holdActive = true;
  cancelCurrentResponse();
  stopPlayback();
  setConversationMessage("");
  setPhase("listening");
  try {
    // Resuming audio inside this gesture lets Safari play RAT's later response.
    await ensureAudioContext();
    if (!state.holdActive) return;
    await startMicrophone();
  } catch (error) {
    stopMicrophone();
    if (state.holdActive) setPhase("error", `${error.message || error} Hold to retry.`);
  }
}

async function endHold(event) {
  if (!state.holdActive) return;
  event?.preventDefault();
  state.holdActive = false;
  const chunks = state.utterance;
  const captureMs = state.captureMs;
  const sourceRate = state.audioContext?.sampleRate || 16_000;
  const wasRecording = state.recording;
  stopMicrophone();
  resetCapture();
  setPhase("ready");
  if (!wasRecording || captureMs < 250 || !chunks.length) {
    if (wasRecording) setConversationMessage("Hold a little longer, then release.");
    return;
  }
  const utterance = resample(concatenateChunks(chunks), sourceRate);
  await sendUtterance(utterance);
}

function decodeBase64Audio(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "audio/wav" });
}

async function playAudio(blob, requestId = state.requestSerial, endingPhase = "ready") {
  await ensureAudioContext();
  const encoded = await blob.arrayBuffer();
  const decoded = await state.audioContext.decodeAudioData(encoded);
  if (requestId !== state.requestSerial || state.holdActive) return false;
  stopPlayback();
  const node = state.audioContext.createBufferSource();
  node.buffer = decoded;
  node.connect(state.analyser);
  state.responseNode = node;
  return new Promise((resolve) => {
    state.responseResolve = resolve;
    node.onended = () => {
      if (state.responseNode !== node) return;
      state.responseNode = null;
      state.responseResolve = null;
      node.disconnect();
      if (!state.holdActive) setPhase(endingPhase);
      resolve(true);
    };
    setPhase("speaking");
    node.start();
  });
}

async function sendUtterance(samples) {
  const requestId = state.requestSerial + 1;
  state.requestSerial = requestId;
  const controller = new AbortController();
  state.requestController = controller;
  state.processing = true;
  setPhase("thinking");
  try {
    const mullResponse = await gatewayFetch("/api/mull", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: samples.buffer,
      signal: controller.signal,
    });
    if (requestId !== state.requestSerial) return;
    if (!mullResponse.ok) {
      throw new Error(await responseError(mullResponse, "RAT did not understand that."));
    }
    const mull = await mullResponse.json();
    if (requestId !== state.requestSerial) return;
    ui.conversationMessage.textContent = mull.mull || "";

    const mullPlayback = mull.audio_wav
      ? playAudio(decodeBase64Audio(mull.audio_wav), requestId, "thinking")
      : Promise.resolve(false);
    const responseRequest = gatewayFetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: mull.transcript }),
      signal: controller.signal,
    });
    const [response] = await Promise.all([responseRequest, mullPlayback]);
    if (requestId !== state.requestSerial) return;
    if (!response.ok) {
      throw new Error(await responseError(response, "RAT could not finish that thought."));
    }
    const payload = await response.json();
    if (requestId !== state.requestSerial) return;
    ui.conversationMessage.textContent = payload.response || "";
    if (!payload.audio_wav) {
      setPhase("ready");
      return;
    }
    await playAudio(decodeBase64Audio(payload.audio_wav), requestId);
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.requestSerial) return;
    const message = String(error.message || error);
    if (message.includes("No speech detected")) {
      stopPlayback();
      setConversationMessage("");
      setPhase("ready");
    } else {
      stopPlayback();
      setPhase("error", `${message} Hold to try again.`);
    }
  } finally {
    if (requestId === state.requestSerial) {
      state.processing = false;
      state.requestController = null;
    }
  }
}

async function speakText(text, requestId) {
  const response = await gatewayFetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: state.requestController?.signal,
  });
  if (!response.ok) throw new Error(await responseError(response, "Speech synthesis failed."));
  await playAudio(await response.blob(), requestId);
}

async function submitText(event) {
  event.preventDefault();
  const value = ui.textInput.value.trim();
  if (!value || !state.projectId) return;
  cancelCurrentResponse();
  stopPlayback();
  const requestId = state.requestSerial + 1;
  state.requestSerial = requestId;
  const controller = new AbortController();
  state.requestController = controller;
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
        body: JSON.stringify({ text: value }),
        signal: controller.signal,
      },
    );
    if (requestId !== state.requestSerial) return;
    if (!response.ok) throw new Error(await responseError(response, "RAT could not respond."));
    const turn = await response.json();
    ui.conversationMessage.textContent = turn.spoken_response || "";
    await speakText(turn.spoken_response, requestId);
  } catch (error) {
    if (error.name !== "AbortError" && requestId === state.requestSerial) {
      setPhase("error", error.message || String(error));
    }
  } finally {
    if (requestId === state.requestSerial) {
      state.processing = false;
      state.requestController = null;
    }
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
  state.holdActive = false;
  cancelCurrentResponse();
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
    } else if (state.phase === "listening") {
      amplitude = Math.sin(progress * 24 + time / 120) * height
        * Math.max(0.025, Math.min(0.18, state.inputLevel * 3.5)) * envelope;
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
    : ["listening", "speaking"].includes(state.phase)
      ? "rgba(183, 255, 90, 0.96)"
      : "rgba(236, 233, 223, 0.34)";
  context.shadowBlur = ["listening", "speaking"].includes(state.phase) ? 20 * density : 0;
  context.shadowColor = "rgba(183, 255, 90, 0.4)";
  context.stroke();
  state.animationFrame = window.requestAnimationFrame(drawWaveform);
}

ui.gatewayLoginForm.addEventListener("submit", loginGateway);
ui.waveformSurface.addEventListener("pointerdown", beginHold);
ui.waveformSurface.addEventListener("pointerup", endHold);
ui.waveformSurface.addEventListener("pointercancel", endHold);
ui.waveformSurface.addEventListener("lostpointercapture", endHold);
ui.waveformSurface.addEventListener("contextmenu", (event) => event.preventDefault());
ui.textComposer.addEventListener("submit", submitText);

window.addEventListener("keydown", (event) => {
  if (!gateway.authenticated) return;
  if (event.key === "Escape") {
    if (state.holdActive) endHold(event);
    else if (!ui.textComposer.hidden) {
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
    return;
  }
  if ([" ", "Enter"].includes(event.key)
      && document.activeElement === ui.waveformSurface
      && !event.repeat) {
    beginHold(event);
  }
});

window.addEventListener("keyup", (event) => {
  if ([" ", "Enter"].includes(event.key) && state.holdActive) endHold(event);
});

window.addEventListener("blur", () => {
  if (state.holdActive) endHold();
});

const suggestedGateway = location.protocol === "https:" && location.hostname.endsWith("github.io")
  ? ""
  : location.origin;
ui.gatewayUrl.value = suggestedGateway;
state.animationFrame = window.requestAnimationFrame(drawWaveform);
