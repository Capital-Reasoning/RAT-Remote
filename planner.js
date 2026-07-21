const plannerUi = {
  projectSelect: document.querySelector("#projectSelect"),
  refreshButton: document.querySelector("#refreshProjectButton"),
  exportMarkdownButton: document.querySelector("#exportMarkdownButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportDocxButton: document.querySelector("#exportDocxButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  exportBundleButton: document.querySelector("#exportBundleButton"),
  newProjectForm: document.querySelector("#newProjectForm"),
  newProjectTitle: document.querySelector("#newProjectTitle"),
  newProjectIdea: document.querySelector("#newProjectIdea"),
  newProjectPolicy: document.querySelector("#newProjectPolicy"),
  importProjectForm: document.querySelector("#importProjectForm"),
  projectDocument: document.querySelector("#projectDocument"),
  importProjectTitle: document.querySelector("#importProjectTitle"),
  importProjectPolicy: document.querySelector("#importProjectPolicy"),
  importBundleForm: document.querySelector("#importBundleForm"),
  projectBundle: document.querySelector("#projectBundle"),
  bundleImportMode: document.querySelector("#bundleImportMode"),
  plannerMessage: document.querySelector("#plannerMessage"),
  planWorkspace: document.querySelector("#planWorkspace"),
  planningTurnForm: document.querySelector("#planningTurnForm"),
  planningTurnText: document.querySelector("#planningTurnText"),
  nextQuestion: document.querySelector("#nextQuestion"),
  spokenResponse: document.querySelector("#spokenResponse"),
  gateList: document.querySelector("#gateList"),
  stageBadge: document.querySelector("#stageBadge"),
  readinessBadge: document.querySelector("#readinessBadge"),
  receiptCard: document.querySelector("#receiptCard"),
  receiptGrid: document.querySelector("#receiptGrid"),
  graphSection: document.querySelector("#graphSection"),
  graphTitle: document.querySelector("#graphTitle"),
  nodeCount: document.querySelector("#nodeCount"),
  nodeGroups: document.querySelector("#nodeGroups"),
  profilePanel: document.querySelector("#profilePanel"),
  profileTitle: document.querySelector("#profileTitle"),
  profileDescription: document.querySelector("#profileDescription"),
  flagshipBadge: document.querySelector("#flagshipBadge"),
  communicationProfileSelect: document.querySelector("#communicationProfileSelect"),
  voiceProfileSelect: document.querySelector("#voiceProfileSelect"),
  challengeLevel: document.querySelector("#challengeLevel"),
  challengeOutput: document.querySelector("#challengeOutput"),
  socraticPressure: document.querySelector("#socraticPressure"),
  socraticOutput: document.querySelector("#socraticOutput"),
  brevityWords: document.querySelector("#brevityWords"),
  voiceSpeed: document.querySelector("#voiceSpeed"),
  voiceSpeedOutput: document.querySelector("#voiceSpeedOutput"),
  respiratoryEffects: document.querySelector("#respiratoryEffects"),
  coughIntensity: document.querySelector("#coughIntensity"),
  coughOutput: document.querySelector("#coughOutput"),
  wheezeIntensity: document.querySelector("#wheezeIntensity"),
  wheezeOutput: document.querySelector("#wheezeOutput"),
  saveProfilesButton: document.querySelector("#saveProfilesButton"),
  previewVoiceButton: document.querySelector("#previewVoiceButton"),
  questionRationale: document.querySelector("#questionRationale"),
};

const plannerState = {
  projectId: null,
  view: null,
  busy: false,
  profiles: { communication: [], voice: [], defaults: {} },
};

function plannerMessage(text, state = "ok") {
  plannerUi.plannerMessage.textContent = text;
  plannerUi.plannerMessage.dataset.state = state;
}

async function plannerFetch(path, options = {}) {
  const response = await window.ratGateway.fetch(path, options);
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`);
  }
  return response;
}

function readable(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setBusy(value) {
  plannerState.busy = value;
  for (const element of [
    plannerUi.refreshButton,
    plannerUi.exportMarkdownButton,
    plannerUi.exportJsonButton,
    plannerUi.exportDocxButton,
    plannerUi.exportPdfButton,
    plannerUi.exportBundleButton,
    plannerUi.saveProfilesButton,
    plannerUi.previewVoiceButton,
  ]) {
    element.disabled = value || (!plannerState.projectId && element !== plannerUi.refreshButton);
  }
  plannerUi.newProjectForm.querySelector("button").disabled = value;
  plannerUi.importProjectForm.querySelector("button").disabled = value;
  plannerUi.importBundleForm.querySelector("button").disabled = value;
  plannerUi.planningTurnForm.querySelector("button").disabled = value;
}

async function loadProfileCatalog() {
  const response = await plannerFetch("/api/profiles");
  plannerState.profiles = await response.json();
  plannerUi.communicationProfileSelect.replaceChildren();
  for (const profile of plannerState.profiles.communication || []) {
    plannerUi.communicationProfileSelect.add(new Option(profile.label, profile.id));
  }
  plannerUi.voiceProfileSelect.replaceChildren();
  for (const profile of plannerState.profiles.voice || []) {
    plannerUi.voiceProfileSelect.add(new Option(profile.label, profile.id));
  }
}

async function loadProjects(preferredId = plannerState.projectId) {
  const response = await plannerFetch("/api/projects");
  const payload = await response.json();
  const projects = payload.projects || [];
  plannerUi.projectSelect.replaceChildren(new Option("Create or import a project", ""));
  for (const project of projects) {
    const option = new Option(
      `${project.title} · ${readable(project.readiness)}`,
      project.id,
    );
    plannerUi.projectSelect.add(option);
  }

  const selected = projects.find((project) => project.id === preferredId)
    || projects[0];
  if (selected) {
    plannerUi.projectSelect.value = selected.id;
    await selectProject(selected.id);
  } else {
    renderEmpty();
  }
}

async function selectProject(projectId) {
  if (!projectId) {
    plannerState.projectId = null;
    renderEmpty();
    return;
  }
  plannerMessage("Loading project state…");
  await plannerFetch(`/api/projects/${encodeURIComponent(projectId)}/select`, {
    method: "POST",
  });
  plannerState.projectId = projectId;
  const response = await plannerFetch(`/api/projects/${encodeURIComponent(projectId)}`);
  renderProject(await response.json());
}

async function refreshProject() {
  if (!plannerState.projectId) return;
  const response = await plannerFetch(
    `/api/projects/${encodeURIComponent(plannerState.projectId)}`,
  );
  renderProject(await response.json());
}

function renderEmpty() {
  plannerState.view = null;
  plannerUi.planWorkspace.hidden = true;
  plannerUi.graphSection.hidden = true;
  plannerUi.receiptCard.hidden = true;
  plannerUi.profilePanel.hidden = true;
  plannerUi.stageBadge.textContent = "No project";
  plannerUi.readinessBadge.textContent = "Draft";
  plannerUi.exportMarkdownButton.disabled = true;
  plannerUi.exportJsonButton.disabled = true;
  plannerUi.exportDocxButton.disabled = true;
  plannerUi.exportPdfButton.disabled = true;
  plannerUi.exportBundleButton.disabled = true;
  plannerMessage("Create a new project or import an existing project document.");
}

function renderProject(view) {
  plannerState.view = view;
  plannerState.projectId = view.project.id;
  const report = view.gate_report;
  plannerUi.planWorkspace.hidden = false;
  plannerUi.graphSection.hidden = false;
  plannerUi.profilePanel.hidden = false;
  plannerUi.stageBadge.textContent = readable(view.project.current_stage);
  plannerUi.readinessBadge.textContent = readable(view.project.readiness);
  plannerUi.nextQuestion.textContent = report.next_question || "All handoff gates pass.";
  plannerUi.graphTitle.textContent = view.project.title;
  plannerUi.nodeCount.textContent = `${view.nodes.length} node${view.nodes.length === 1 ? "" : "s"}`;
  plannerUi.exportMarkdownButton.disabled = false;
  plannerUi.exportJsonButton.disabled = false;
  plannerUi.exportDocxButton.disabled = false;
  plannerUi.exportPdfButton.disabled = false;
  plannerUi.exportBundleButton.disabled = false;
  const selectedOption = [...plannerUi.projectSelect.options].find(
    (option) => option.value === view.project.id,
  );
  if (selectedOption) {
    selectedOption.textContent = `${view.project.title} · ${readable(view.project.readiness)}`;
  }
  plannerMessage(
    `${view.project.title} is selected for text and voice planning. `
      + `${report.failed_gates.length} readiness gate${report.failed_gates.length === 1 ? " remains" : "s remain"}.`,
  );
  renderGates(report.checks || []);
  renderNodes(view.nodes_by_type || {});
  renderProfiles(view.project.communication_profile, view.project.voice_profile);
}

function renderProfiles(communication, voice) {
  const safeCommunication = communication || plannerState.profiles.communication?.[0] || {};
  const safeVoice = voice || plannerState.profiles.voice?.[0] || {};
  plannerUi.communicationProfileSelect.value = safeCommunication.id || "";
  plannerUi.voiceProfileSelect.value = safeVoice.id || "";
  plannerUi.challengeLevel.value = safeCommunication.challenge_level ?? 0.5;
  plannerUi.socraticPressure.value = safeCommunication.socratic_pressure ?? 0.5;
  plannerUi.brevityWords.value = safeCommunication.brevity_words ?? 30;
  plannerUi.voiceSpeed.value = safeVoice.speed ?? 1;
  plannerUi.respiratoryEffects.checked = Boolean(safeVoice.respiratory_effects_enabled);
  plannerUi.coughIntensity.value = safeVoice.cough_intensity ?? 0;
  plannerUi.wheezeIntensity.value = safeVoice.wheeze_intensity ?? 0;
  plannerUi.profileTitle.textContent = safeCommunication.label || "Communication profile";
  plannerUi.profileDescription.textContent = safeCommunication.persona || "";
  plannerUi.flagshipBadge.hidden = !(
    safeCommunication.id === plannerState.profiles.defaults?.communication
    && safeVoice.id === plannerState.profiles.defaults?.voice
  );
  updateProfileOutputs();
}

function updateProfileOutputs() {
  plannerUi.challengeOutput.textContent = `${Math.round(Number(plannerUi.challengeLevel.value) * 100)}%`;
  plannerUi.socraticOutput.textContent = `${Math.round(Number(plannerUi.socraticPressure.value) * 100)}%`;
  plannerUi.voiceSpeedOutput.textContent = `${Number(plannerUi.voiceSpeed.value).toFixed(2)}×`;
  plannerUi.coughOutput.textContent = `${Math.round(Number(plannerUi.coughIntensity.value) * 100)}%`;
  plannerUi.wheezeOutput.textContent = `${Math.round(Number(plannerUi.wheezeIntensity.value) * 100)}%`;
}

function selectedPreset(kind, id) {
  return (plannerState.profiles[kind] || []).find((item) => item.id === id);
}

function currentCommunicationForm() {
  return {
    ...(selectedPreset("communication", plannerUi.communicationProfileSelect.value) || {}),
    challenge_level: Number(plannerUi.challengeLevel.value),
    socratic_pressure: Number(plannerUi.socraticPressure.value),
    brevity_words: Number(plannerUi.brevityWords.value),
  };
}

function currentVoiceForm() {
  return {
    ...(selectedPreset("voice", plannerUi.voiceProfileSelect.value) || {}),
    speed: Number(plannerUi.voiceSpeed.value),
    respiratory_effects_enabled: plannerUi.respiratoryEffects.checked,
    cough_intensity: Number(plannerUi.coughIntensity.value),
    wheeze_intensity: Number(plannerUi.wheezeIntensity.value),
  };
}

async function saveProfiles({ quiet = false } = {}) {
  if (!plannerState.projectId || plannerState.busy) return false;
  setBusy(true);
  try {
    const response = await plannerFetch(
      `/api/projects/${encodeURIComponent(plannerState.projectId)}/profiles`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          communication: {
            id: plannerUi.communicationProfileSelect.value,
            challenge_level: Number(plannerUi.challengeLevel.value),
            socratic_pressure: Number(plannerUi.socraticPressure.value),
            brevity_words: Number(plannerUi.brevityWords.value),
          },
          voice: {
            id: plannerUi.voiceProfileSelect.value,
            speed: Number(plannerUi.voiceSpeed.value),
            respiratory_effects_enabled: plannerUi.respiratoryEffects.checked,
            cough_intensity: Number(plannerUi.coughIntensity.value),
            wheeze_intensity: Number(plannerUi.wheezeIntensity.value),
          },
        }),
      },
    );
    const view = await response.json();
    renderProject(view);
    if (!quiet) plannerMessage("Voice and communication profile saved for this project.");
    return true;
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
    return false;
  } finally {
    setBusy(false);
  }
}

async function previewVoice() {
  const saved = await saveProfiles({ quiet: true });
  if (!saved) return;
  const sent = window.ratVoiceControl?.send({
    type: "preview_voice",
    text: "Mm. Another plan with several preventable ways to fail. Which assumption will betray us first?",
  });
  plannerMessage(
    sent
      ? "Voice preview queued on the connected speaker."
      : "Connect audio first, then preview the selected voice.",
    sent ? "ok" : "error",
  );
}

function renderGates(checks) {
  plannerUi.gateList.replaceChildren();
  const currentStage = plannerState.view?.gate_report?.stage;
  const relevant = checks.filter(
    (check) => check.stage === currentStage || (!check.passed && check.critical),
  );
  for (const check of relevant.slice(0, 12)) {
    const item = document.createElement("li");
    item.className = check.passed ? "passed" : "failed";
    item.textContent = `${readable(check.stage)} · ${check.label}`;
    plannerUi.gateList.append(item);
  }
}

function renderNodes(groups) {
  plannerUi.nodeGroups.replaceChildren();
  const labels = {
    objective: "Objectives",
    non_goal: "Non-goals",
    constraint: "Constraints",
    assumption: "Assumptions",
    requirement: "Requirements",
    decision: "Decisions",
    risk: "Risks",
    dependency: "Dependencies",
    question: "Questions",
    evidence: "Evidence",
    branch: "Branches",
    acceptance_criterion: "Acceptance criteria",
    work_package: "Work packages",
  };
  for (const [type, nodes] of Object.entries(groups)) {
    if (!nodes.length) continue;
    const group = document.createElement("article");
    group.className = "node-group";
    const heading = document.createElement("h3");
    const label = document.createElement("span");
    heading.textContent = labels[type] || readable(type);
    label.textContent = nodes.length;
    heading.append(label);
    const list = document.createElement("ul");
    for (const node of nodes.slice(0, 12)) {
      const item = document.createElement("li");
      item.textContent = node.statement;
      const metadata = document.createElement("small");
      metadata.textContent = `${readable(node.status)} · ${node.id} · r${node.revision}`;
      item.append(metadata);
      if (node.status === "proposed") {
        const actions = document.createElement("div");
        actions.className = "node-actions";
        actions.append(
          nodeActionButton("Accept", "accept", node.id),
          nodeActionButton("Reject", "reject", node.id),
        );
        if (node.type === "branch") {
          actions.append(nodeActionButton("Park", "park", node.id));
        }
        item.append(actions);
      } else if (node.type === "branch" && node.status === "active") {
        const actions = document.createElement("div");
        actions.className = "node-actions";
        actions.append(nodeActionButton("Park", "park", node.id));
        item.append(actions);
      }
      list.append(item);
    }
    group.append(heading, list);
    plannerUi.nodeGroups.append(group);
  }
}

function nodeActionButton(label, action, nodeId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "node-action";
  button.textContent = label;
  button.addEventListener("click", () => {
    reviewNode(nodeId, action).catch((error) =>
      plannerMessage(error.message || String(error), "error"),
    );
  });
  return button;
}

async function reviewNode(nodeId, action) {
  if (!plannerState.projectId || plannerState.busy) return;
  setBusy(true);
  try {
    const response = await plannerFetch(
      `/api/projects/${encodeURIComponent(plannerState.projectId)}`
        + `/nodes/${encodeURIComponent(nodeId)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    const result = await response.json();
    renderProject(result.view);
    plannerMessage(`${readable(action)} review applied to ${nodeId}.`);
  } finally {
    setBusy(false);
  }
}

function renderReceipt(receipt) {
  if (!receipt) return;
  const fields = [
    ["Nodes added", receipt.nodes_added],
    ["Assumptions", receipt.assumptions_exposed],
    ["Decisions", receipt.decisions_made],
    ["Risks", receipt.risks_discovered],
    ["Dependencies", receipt.dependencies_discovered],
    ["Branches parked", receipt.branches_parked],
    ["Acceptance criteria", receipt.acceptance_criteria_added],
    ["Blockers left", receipt.remaining_blockers],
  ];
  plannerUi.receiptGrid.replaceChildren();
  for (const [label, value] of fields) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value ?? "—";
    wrapper.append(term, detail);
    plannerUi.receiptGrid.append(wrapper);
  }
  plannerUi.receiptCard.hidden = false;
}

async function createNewProject(event) {
  event.preventDefault();
  setBusy(true);
  try {
    const response = await plannerFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: plannerUi.newProjectTitle.value,
        initial_idea: plannerUi.newProjectIdea.value,
        data_policy: plannerUi.newProjectPolicy.value,
      }),
    });
    const view = await response.json();
    plannerUi.newProjectForm.reset();
    await loadProjects(view.project.id);
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function importExistingProject(event) {
  event.preventDefault();
  const file = plannerUi.projectDocument.files[0];
  if (!file) return;
  setBusy(true);
  plannerMessage(`Importing ${file.name} locally…`);
  try {
    const body = new FormData();
    body.set("document", file);
    body.set("title", plannerUi.importProjectTitle.value);
    body.set("data_policy", plannerUi.importProjectPolicy.value);
    const response = await plannerFetch("/api/projects/import", {
      method: "POST",
      body,
    });
    const view = await response.json();
    plannerUi.importProjectForm.reset();
    await loadProjects(view.project.id);
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function importPortableProject(event) {
  event.preventDefault();
  const file = plannerUi.projectBundle.files[0];
  if (!file) return;
  setBusy(true);
  plannerMessage(`Restoring ${file.name} on the local gateway…`);
  try {
    const body = new FormData();
    body.set("bundle", file);
    body.set("mode", plannerUi.bundleImportMode.value);
    const response = await plannerFetch("/api/projects/import-bundle", {
      method: "POST",
      body,
    });
    const view = await response.json();
    plannerUi.importBundleForm.reset();
    await loadProjects(view.project.id);
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function processPlanningTurn(event) {
  event.preventDefault();
  if (!plannerState.projectId) return;
  const text = plannerUi.planningTurnText.value.trim();
  if (!text) return;
  setBusy(true);
  plannerMessage("Extracting atomic changes and checking readiness…");
  try {
    const response = await plannerFetch(
      `/api/projects/${encodeURIComponent(plannerState.projectId)}/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    const turn = await response.json();
    plannerUi.planningTurnText.value = "";
    plannerUi.spokenResponse.textContent = turn.spoken_response;
    plannerUi.questionRationale.textContent = turn.question_rationale || "";
    renderReceipt(turn.receipt);
    await refreshProject();
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function exportProject(format) {
  if (!plannerState.projectId) return;
  try {
    const response = await plannerFetch(
      `/api/projects/${encodeURIComponent(plannerState.projectId)}/export?format=${format}`,
    );
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const extensions = {
      markdown: "md",
      json: "json",
      docx: "docx",
      pdf: "pdf",
      bundle: "ratproject",
    };
    link.download = match?.[1] || `rat-project.${extensions[format] || format}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  }
}

plannerUi.projectSelect.addEventListener("change", () => {
  selectProject(plannerUi.projectSelect.value).catch((error) =>
    plannerMessage(error.message || String(error), "error"),
  );
});
plannerUi.refreshButton.addEventListener("click", () => {
  refreshProject().catch((error) => plannerMessage(error.message || String(error), "error"));
});
plannerUi.exportMarkdownButton.addEventListener("click", () => exportProject("markdown"));
plannerUi.exportJsonButton.addEventListener("click", () => exportProject("json"));
plannerUi.exportDocxButton.addEventListener("click", () => exportProject("docx"));
plannerUi.exportPdfButton.addEventListener("click", () => exportProject("pdf"));
plannerUi.exportBundleButton.addEventListener("click", () => exportProject("bundle"));
plannerUi.newProjectForm.addEventListener("submit", createNewProject);
plannerUi.importProjectForm.addEventListener("submit", importExistingProject);
plannerUi.importBundleForm.addEventListener("submit", importPortableProject);
plannerUi.planningTurnForm.addEventListener("submit", processPlanningTurn);
plannerUi.saveProfilesButton.addEventListener("click", () => saveProfiles());
plannerUi.previewVoiceButton.addEventListener("click", previewVoice);
plannerUi.communicationProfileSelect.addEventListener("change", () => {
  const preset = selectedPreset("communication", plannerUi.communicationProfileSelect.value);
  if (preset) renderProfiles(preset, currentVoiceForm());
});
plannerUi.voiceProfileSelect.addEventListener("change", () => {
  const preset = selectedPreset("voice", plannerUi.voiceProfileSelect.value);
  if (preset) renderProfiles(currentCommunicationForm(), preset);
});
for (const input of [
  plannerUi.challengeLevel,
  plannerUi.socraticPressure,
  plannerUi.voiceSpeed,
  plannerUi.coughIntensity,
  plannerUi.wheezeIntensity,
]) {
  input.addEventListener("input", updateProfileOutputs);
}

window.addEventListener("rat:voice-event", (event) => {
  if (event.detail?.event === "model_reflection") {
    plannerUi.spokenResponse.textContent = event.detail.text || "Voice turn processed.";
    window.setTimeout(() => {
      refreshProject().catch((error) => plannerMessage(error.message || String(error), "error"));
    }, 100);
  }
  if (event.detail?.event === "project_selected" && event.detail.project_id) {
    plannerUi.projectSelect.value = event.detail.project_id;
  }
});

async function startPlanner() {
  setBusy(true);
  plannerMessage("Loading projects from the private gateway…");
  try {
    await loadProfileCatalog();
    await loadProjects();
  } catch (error) {
    plannerMessage(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

window.addEventListener("rat:auth-ready", () => startPlanner());
window.addEventListener("rat:auth-lost", () => {
  plannerState.projectId = null;
  renderEmpty();
  plannerMessage("Gateway locked. Unlock it above to access local projects.", "error");
  setBusy(true);
});

if (window.ratGateway?.isAuthenticated()) {
  startPlanner();
} else {
  plannerMessage("Unlock the private gateway above. No project data is stored on GitHub Pages.");
  setBusy(true);
}
