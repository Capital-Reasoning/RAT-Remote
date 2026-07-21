const ui = {
  connectionPill: document.querySelector("#connectionPill"),
  connectionLabel: document.querySelector("#connectionLabel"),
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  inputDevice: document.querySelector("#inputDevice"),
  outputDevice: document.querySelector("#outputDevice"),
  remoteAudio: document.querySelector("#remoteAudio"),
  speechAudio: document.querySelector("#speechAudio"),
  secureWarning: document.querySelector("#secureWarning"),
  secureState: document.querySelector("#secureState"),
  transcript: document.querySelector("#transcript"),
  modelComment: document.querySelector("#modelComment"),
  listeningIndicator: document.querySelector("#listeningIndicator"),
  observedMetric: document.querySelector("#observedMetric"),
  asrMetric: document.querySelector("#asrMetric"),
  ttsMetric: document.querySelector("#ttsMetric"),
  onsetMetric: document.querySelector("#onsetMetric"),
  rttMetric: document.querySelector("#rttMetric"),
  eventsList: document.querySelector("#eventsList"),
  clearEventsButton: document.querySelector("#clearEventsButton"),
  gatewayPanel: document.querySelector("#gatewayPanel"),
  gatewayLoginForm: document.querySelector("#gatewayLoginForm"),
  gatewayUrl: document.querySelector("#gatewayUrl"),
  gatewayPassword: document.querySelector("#gatewayPassword"),
  gatewayLoginButton: document.querySelector("#gatewayLoginButton"),
  gatewayLogoutButton: document.querySelector("#gatewayLogoutButton"),
  gatewayStatus: document.querySelector("#gatewayStatus"),
  voiceInputControls: document.querySelector("#voiceInputControls"),
  textInputModeButton: document.querySelector("#textInputModeButton"),
  voiceInputModeButton: document.querySelector("#voiceInputModeButton"),
  inputModeHelp: document.querySelector("#inputModeHelp"),
  outputMuteButton: document.querySelector("#outputMuteButton"),
  outputModeLabel: document.querySelector("#outputModeLabel"),
};

const state = {
  pc: null,
  channel: null,
  localStream: null,
  remoteStream: null,
  pingTimer: null,
  speechController: null,
  speechObjectUrl: "",
  inputMode: "text",
  outputMuted: false,
  events: [],
};

const gatewayState = {
  apiBase: "",
  bearer: "",
  authenticated: false,
};

function normalizeGatewayUrl(value) {
  const url = new URL(value);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Use an HTTPS gateway URL. Plain HTTP is allowed only on localhost.");
  }
  if (url.username || url.password) {
    throw new Error("Do not put credentials in the gateway URL.");
  }
  return url.origin;
}

function gatewayStatus(message, value = "idle") {
  ui.gatewayStatus.textContent = message;
  ui.gatewayStatus.dataset.state = value;
}

function gatewayHeaders(existing = {}) {
  const headers = new Headers(existing);
  if (gatewayState.bearer) {
    headers.set("Authorization", `Bearer ${gatewayState.bearer}`);
  }
  return headers;
}

async function gatewayFetch(path, options = {}) {
  if (!gatewayState.authenticated || !gatewayState.apiBase) {
    throw new Error("Unlock the private model gateway first.");
  }
  const response = await fetch(`${gatewayState.apiBase}${path}`, {
    ...options,
    headers: gatewayHeaders(options.headers || {}),
  });
  if (response.status === 401) {
    gatewayState.bearer = "";
    gatewayState.authenticated = false;
    ui.connectButton.disabled = true;
    ui.gatewayLogoutButton.hidden = true;
    ui.gatewayLoginButton.disabled = false;
    gatewayStatus("The gateway session expired. Unlock it again.", "error");
    window.dispatchEvent(new CustomEvent("rat:auth-lost"));
  }
  return response;
}

function announceGatewayReady() {
  ui.gatewayLoginButton.disabled = true;
  ui.gatewayLogoutButton.hidden = false;
  ui.connectButton.disabled = state.inputMode !== "voice";
  setConnection("Gateway ready", "connected");
  gatewayStatus(
    `Unlocked ${gatewayState.apiBase}. The password and session token are kept in memory only.`,
    "connected",
  );
  window.dispatchEvent(
    new CustomEvent("rat:auth-ready", { detail: { apiBase: gatewayState.apiBase } }),
  );
}

async function loginGateway(event) {
  event.preventDefault();
  ui.gatewayLoginButton.disabled = true;
  gatewayStatus("Verifying with the local gateway…");
  try {
    const apiBase = normalizeGatewayUrl(ui.gatewayUrl.value.trim());
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ui.gatewayPassword.value }),
    });
    ui.gatewayPassword.value = "";
    if (!response.ok) {
      let message = await response.text();
      try {
        message = JSON.parse(message).error || message;
      } catch (_error) {
        // Plain-text gateway errors remain readable.
      }
      throw new Error(message || `Login failed (${response.status})`);
    }
    const payload = await response.json();
    gatewayState.apiBase = apiBase;
    gatewayState.bearer = payload.token;
    gatewayState.authenticated = true;
    announceGatewayReady();
  } catch (error) {
    ui.gatewayPassword.value = "";
    ui.gatewayLoginButton.disabled = false;
    gatewayStatus(error.message || String(error), "error");
    setConnection("Gateway locked", "error");
  }
}

async function logoutGateway() {
  try {
    if (gatewayState.authenticated) {
      await gatewayFetch("/api/auth/logout", { method: "POST" });
    }
  } catch (_error) {
    // Locking locally remains valid when the gateway is unreachable.
  }
  disconnect();
  stopTextResponse();
  gatewayState.bearer = "";
  gatewayState.authenticated = false;
  ui.connectButton.disabled = true;
  ui.gatewayLoginButton.disabled = false;
  ui.gatewayLogoutButton.hidden = true;
  gatewayStatus("Locked. Credentials are held in memory only.");
  window.dispatchEvent(new CustomEvent("rat:auth-lost"));
}

window.ratGateway = {
  fetch: gatewayFetch,
  isAuthenticated: () => gatewayState.authenticated,
  apiBase: () => gatewayState.apiBase,
};

function setConnection(label, value) {
  ui.connectionLabel.textContent = label;
  ui.connectionPill.dataset.state = value;
}

function releaseSpeechUrl() {
  if (state.speechObjectUrl) {
    URL.revokeObjectURL(state.speechObjectUrl);
    state.speechObjectUrl = "";
  }
}

function stopTextResponse() {
  state.speechController?.abort();
  state.speechController = null;
  ui.speechAudio.pause();
  ui.speechAudio.removeAttribute("src");
  ui.speechAudio.load();
  releaseSpeechUrl();
}

function setInputMode(mode) {
  if (!new Set(["text", "voice"]).has(mode)) return;
  const changed = state.inputMode !== mode;
  state.inputMode = mode;
  if (mode === "text" && state.pc) disconnect();
  ui.textInputModeButton.setAttribute("aria-pressed", String(mode === "text"));
  ui.voiceInputModeButton.setAttribute("aria-pressed", String(mode === "voice"));
  ui.voiceInputControls.hidden = mode !== "voice";
  ui.inputModeHelp.textContent = mode === "voice"
    ? "Microphone input · text transcript remains visible"
    : "Keyboard input · no microphone";
  ui.secureWarning.hidden = trustworthy || mode !== "voice";
  ui.connectButton.disabled = !gatewayState.authenticated || mode !== "voice";
  window.dispatchEvent(new CustomEvent("rat:input-mode", { detail: { mode } }));
  if (changed) addEvent({ event: "input_mode", mode });
}

function setOutputMuted(muted, { announce = true } = {}) {
  state.outputMuted = Boolean(muted);
  ui.remoteAudio.muted = state.outputMuted;
  ui.speechAudio.muted = state.outputMuted;
  ui.outputDevice.disabled = state.outputMuted;
  ui.outputMuteButton.setAttribute("aria-pressed", String(state.outputMuted));
  ui.outputMuteButton.dataset.muted = String(state.outputMuted);
  ui.outputModeLabel.textContent = state.outputMuted ? "Voice muted" : "Voice on";
  if (state.outputMuted) stopTextResponse();
  if (announce) addEvent({ event: "output_mode", muted: state.outputMuted });
}

async function speakTextResponse(value) {
  const text = " ".concat(value || "").trim().replace(/\s+/g, " ").slice(0, 1000);
  if (!text || state.outputMuted || !gatewayState.authenticated) return false;
  stopTextResponse();
  const controller = new AbortController();
  state.speechController = controller;
  try {
    const response = await gatewayFetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error((await response.text()) || "Speech synthesis failed");
    const blob = await response.blob();
    if (controller.signal.aborted || state.outputMuted) return false;
    state.speechObjectUrl = URL.createObjectURL(blob);
    ui.speechAudio.src = state.speechObjectUrl;
    await applyOutputDevice();
    const inferenceMs = Number(response.headers.get("X-RAT-TTS-Inference-Ms"));
    if (Number.isFinite(inferenceMs)) ui.ttsMetric.textContent = number(inferenceMs);
    await ui.speechAudio.play();
    addEvent({ event: "text_response_audio", text, tts_inference_ms: inferenceMs });
    return true;
  } catch (error) {
    if (error.name !== "AbortError") {
      addEvent({ event: "error", message: `Text response audio failed: ${error.message || error}` });
    }
    return false;
  } finally {
    if (state.speechController === controller) state.speechController = null;
  }
}

function number(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : "—";
}

function eventDetail(event) {
  switch (event.event) {
    case "asr_partial":
      return event.text?.trim() ? `“${event.text.trim()}”` : "No stable prefix";
    case "transcript_commit":
      return `Committed “${event.text}” silently`;
    case "reflection_started":
      return "Larger model is preparing a reflection";
    case "model_reflection":
      return `Reflected “${event.text}”`;
    case "reflection_error":
      return event.message;
    case "playback_started":
      return `Return audio began for “${event.text || "speech"}”`;
    case "playback_cancelled":
      return "Return audio stopped immediately for barge-in";
    case "voice_preview":
      return `Previewing ${event.voice_profile || "selected voice"}`;
    case "text_response_audio":
      return "Played local voice for the typed response";
    case "text_input":
      return `Typed “${event.text}”`;
    case "text_response":
      return `Rendered “${event.text}”`;
    case "input_mode":
      return `${event.mode === "voice" ? "Talk" : "Type"} input selected`;
    case "output_mode":
      return event.muted ? "Voice output muted; text remains visible" : "Voice output enabled";
    case "connection_state":
      return event.state;
    case "pong":
      return `Round trip ${ui.rttMetric.textContent} ms`;
    case "error":
      return event.message;
    default:
      return event.event.replaceAll("_", " ");
  }
}

function addEvent(event) {
  state.events.unshift({ ...event, receivedAt: new Date() });
  state.events = state.events.slice(0, 40);
  ui.eventsList.replaceChildren();

  for (const item of state.events) {
    const row = document.createElement("li");
    const time = document.createElement("span");
    const type = document.createElement("span");
    const detail = document.createElement("span");
    time.className = "event-time";
    type.className = "event-type";
    detail.className = "event-detail";
    time.textContent = item.receivedAt.toLocaleTimeString([], {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
    type.textContent = item.event;
    detail.textContent = eventDetail(item);
    row.append(time, type, detail);
    ui.eventsList.append(row);
  }
}

function handleServerEvent(event) {
  addEvent(event);
  window.dispatchEvent(new CustomEvent("rat:voice-event", { detail: event }));
  switch (event.event) {
    case "ready":
      setConnection("Connected", "connected");
      break;
    case "speech_start":
      ui.listeningIndicator.classList.add("active");
      ui.transcript.textContent = "Listening…";
      ui.modelComment.textContent = "Listening for your complete thought…";
      break;
    case "asr_partial":
      if (event.hypothesis?.trim()) {
        ui.transcript.textContent = event.hypothesis.trim();
      }
      ui.observedMetric.textContent = number(event.audio_position_ms);
      ui.asrMetric.textContent = number(event.asr_inference_ms);
      break;
    case "reflection_started":
      ui.modelComment.textContent = "Thinking…";
      break;
    case "model_reflection":
      ui.modelComment.textContent = event.text || "—";
      ui.ttsMetric.textContent = number(event.tts_inference_ms);
      ui.onsetMetric.textContent = number(event.response_compute_ms);
      break;
    case "reflection_error":
      ui.modelComment.textContent = "Commentator unavailable";
      break;
    case "speech_end":
      ui.listeningIndicator.classList.remove("active");
      ui.observedMetric.textContent = number(event.audio_ms);
      break;
    case "pong": {
      const now = performance.timeOrigin + performance.now();
      ui.rttMetric.textContent = number(now - Number(event.client_time_ms));
      break;
    }
    case "connection_state":
      if (event.state === "connected") {
        setConnection("Connected", "connected");
      }
      break;
    case "error":
      setConnection("Audio error", "error");
      break;
  }
}

function channelMessage(message) {
  try {
    handleServerEvent(JSON.parse(message.data));
  } catch (error) {
    addEvent({ event: "error", message: `Invalid server event: ${error}` });
  }
}

async function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const listener = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", listener);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", listener);
  });
}

function audioConstraints(deviceId = "") {
  return {
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  };
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const previousInput = ui.inputDevice.value;
  const previousOutput = ui.outputDevice.value;
  ui.inputDevice.replaceChildren(new Option("System default", ""));
  ui.outputDevice.replaceChildren(new Option("System default", ""));

  let inputIndex = 1;
  let outputIndex = 1;
  for (const device of devices) {
    if (device.kind === "audioinput") {
      ui.inputDevice.add(
        new Option(device.label || `Microphone ${inputIndex++}`, device.deviceId),
      );
    }
    if (device.kind === "audiooutput") {
      ui.outputDevice.add(
        new Option(device.label || `Speaker ${outputIndex++}`, device.deviceId),
      );
    }
  }

  if ([...ui.inputDevice.options].some((item) => item.value === previousInput)) {
    ui.inputDevice.value = previousInput;
  }
  if ([...ui.outputDevice.options].some((item) => item.value === previousOutput)) {
    ui.outputDevice.value = previousOutput;
  }
}

async function applyOutputDevice() {
  for (const audio of [ui.remoteAudio, ui.speechAudio]) {
    if (typeof audio.setSinkId === "function") {
      await audio.setSinkId(ui.outputDevice.value);
    }
  }
}

async function connect() {
  if (!gatewayState.authenticated) {
    throw new Error("Unlock the private model gateway first.");
  }
  if (state.inputMode !== "voice") {
    throw new Error("Switch input to Talk before connecting the microphone.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This page is not allowed to access a microphone. Use trusted HTTPS.");
  }

  ui.connectButton.disabled = true;
  setConnection("Requesting microphone", "connecting");
  state.localStream = await navigator.mediaDevices.getUserMedia(
    audioConstraints(ui.inputDevice.value),
  );
  await refreshDevices();

  const pc = new RTCPeerConnection({ iceServers: [] });
  state.pc = pc;
  state.remoteStream = new MediaStream();
  ui.remoteAudio.srcObject = state.remoteStream;
  ui.remoteAudio.muted = state.outputMuted;

  pc.addEventListener("track", async (event) => {
    state.remoteStream.addTrack(event.track);
    await applyOutputDevice();
    await ui.remoteAudio.play();
  });

  pc.addEventListener("connectionstatechange", () => {
    const value = pc.connectionState;
    if (value === "connected") setConnection("Connected", "connected");
    if (["failed", "disconnected", "closed"].includes(value)) {
      setConnection(value === "failed" ? "Connection failed" : "Offline", value === "failed" ? "error" : "idle");
    }
  });

  const microphone = state.localStream.getAudioTracks()[0];
  pc.addTransceiver(microphone, { direction: "sendrecv" });

  const channel = pc.createDataChannel("events", { ordered: true });
  state.channel = channel;
  channel.addEventListener("message", channelMessage);
  channel.addEventListener("open", () => {
    state.pingTimer = window.setInterval(() => {
      if (channel.readyState === "open") {
        channel.send(
          JSON.stringify({
            type: "ping",
            client_time_ms: performance.timeOrigin + performance.now(),
          }),
        );
      }
    }, 2000);
  });

  setConnection("Negotiating WebRTC", "connecting");
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIceGathering(pc);

  const response = await gatewayFetch("/api/offer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
    }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const answer = await response.json();
  await pc.setRemoteDescription(answer);
  ui.disconnectButton.disabled = false;
  setConnection("Connecting media", "connecting");
}

function disconnect() {
  if (state.pingTimer) window.clearInterval(state.pingTimer);
  state.pingTimer = null;
  state.channel?.close();
  state.pc?.close();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.remoteStream?.getTracks().forEach((track) => track.stop());
  state.pc = null;
  state.channel = null;
  state.localStream = null;
  state.remoteStream = null;
  ui.remoteAudio.srcObject = null;
  ui.connectButton.disabled = !gatewayState.authenticated || state.inputMode !== "voice";
  ui.disconnectButton.disabled = true;
  ui.listeningIndicator.classList.remove("active");
  setConnection("Offline", "idle");
  addEvent({ event: "client_disconnected" });
}

ui.connectButton.addEventListener("click", async () => {
  try {
    await connect();
  } catch (error) {
    disconnect();
    setConnection("Could not connect", "error");
    addEvent({ event: "error", message: error.message || String(error) });
  }
});

ui.disconnectButton.addEventListener("click", disconnect);
ui.outputDevice.addEventListener("change", () => {
  applyOutputDevice().catch((error) =>
    addEvent({ event: "error", message: `Speaker selection failed: ${error}` }),
  );
});
ui.inputDevice.addEventListener("change", async () => {
  if (!state.pc || !state.localStream) return;
  try {
    const replacement = await navigator.mediaDevices.getUserMedia(
      audioConstraints(ui.inputDevice.value),
    );
    const replacementTrack = replacement.getAudioTracks()[0];
    const sender = state.pc.getSenders().find((item) => item.track?.kind === "audio");
    await sender.replaceTrack(replacementTrack);
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = replacement;
    addEvent({ event: "microphone_changed" });
  } catch (error) {
    addEvent({ event: "error", message: `Microphone selection failed: ${error}` });
  }
});

ui.clearEventsButton.addEventListener("click", () => {
  state.events = [];
  ui.eventsList.innerHTML = '<li class="empty-event">No events yet.</li>';
});

ui.textInputModeButton.addEventListener("click", () => setInputMode("text"));
ui.voiceInputModeButton.addEventListener("click", () => setInputMode("voice"));
ui.outputMuteButton.addEventListener("click", () => setOutputMuted(!state.outputMuted));
ui.speechAudio.addEventListener("ended", releaseSpeechUrl);
window.addEventListener("rat:text-input", (event) => {
  const text = String(event.detail?.text || "").trim();
  if (!text) return;
  ui.transcript.textContent = text;
  ui.modelComment.textContent = "Thinking…";
  addEvent({ event: "text_input", text });
});
window.addEventListener("rat:text-response", (event) => {
  const text = String(event.detail?.text || "").trim();
  if (!text) return;
  ui.modelComment.textContent = text;
  addEvent({ event: "text_response", text });
});

const trustworthy = window.isSecureContext || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
ui.secureWarning.hidden = trustworthy;
ui.secureState.textContent = trustworthy
  ? "Trusted context · encrypted media"
  : "Untrusted page · microphone will be blocked";

ui.gatewayLoginForm.addEventListener("submit", loginGateway);
ui.gatewayLogoutButton.addEventListener("click", logoutGateway);

const suggestedGateway = location.protocol === "https:" && location.hostname.endsWith("github.io")
  ? ""
  : location.origin;
ui.gatewayUrl.value = suggestedGateway;
ui.connectButton.disabled = true;
setConnection("Gateway locked", "idle");

window.ratVoiceControl = {
  send(message) {
    if (!state.channel || state.channel.readyState !== "open") return false;
    state.channel.send(JSON.stringify(message));
    return true;
  },
  isConnected() {
    return state.channel?.readyState === "open";
  },
  inputMode() {
    return state.inputMode;
  },
  outputMuted() {
    return state.outputMuted;
  },
  speakTextResponse,
};

setOutputMuted(false, { announce: false });
setInputMode("text");
