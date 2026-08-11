const query = new URLSearchParams(window.location.search);
const token = query.get("token");
const apiBase = new URL(query.get("apiBase") || ".", window.location.href);
const snapshotPath = query.get("snapshotPath") || "/api/snapshot";
const eventsPath = query.get("eventsPath") || "/api/events";

const elements = {
  connection: document.querySelector("#connection"), connectionLabel: document.querySelector("#connection-label"),
  runCount: document.querySelector("#run-count"), runList: document.querySelector("#run-list"), runEmpty: document.querySelector("#run-empty"),
  timeline: document.querySelector("#timeline"), timelineEmpty: document.querySelector("#timeline-empty"), timelineTitle: document.querySelector("#timeline-title"),
  pause: document.querySelector("#pause-button"), eventSummary: document.querySelector("#event-summary"),
  structured: document.querySelector("#structured-payload"), raw: document.querySelector("#raw-payload"),
  structuredTab: document.querySelector("#structured-tab"), rawTab: document.querySelector("#raw-tab"),
};

const state = { runs: new Map(), selectedRunId: null, selectedEvent: null, paused: false, eventSource: null };

function endpoint(path) {
  const url = new URL(path, apiBase);
  if (token) url.searchParams.set("token", token);
  return url;
}

function setConnection(stateName, label) {
  elements.connection.dataset.state = stateName;
  elements.connectionLabel.textContent = label;
}

function readableTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function normalizeEnvelope(input) {
  const envelope = input?.event && typeof input.event === "object" ? input.event : input;
  if (!envelope || typeof envelope !== "object" || !envelope.runId) return null;
  return {
    version: envelope.version ?? 1, runId: String(envelope.runId), sequence: Number(envelope.sequence) || 0,
    timestamp: envelope.timestamp || new Date().toISOString(), type: String(envelope.type || "activity"),
    stream: String(envelope.stream || "system"), text: typeof envelope.text === "string" ? envelope.text : "",
    data: envelope.data ?? null,
  };
}

function deriveStatus(event, prior = "running") {
  const type = event.type.toLowerCase();
  if (/fail|error|timeout|cancel/.test(type)) return "failed";
  if (/complete|success|exit|finish|end/.test(type)) return "complete";
  if (/start|spawn|stdout|stderr|activity|progress/.test(type)) return "running";
  return prior;
}

function upsertEvent(input) {
  const event = normalizeEnvelope(input);
  if (!event) return;
  const run = state.runs.get(event.runId) || { runId: event.runId, status: "running", events: [] };
  if (run.events.some((known) => known.sequence === event.sequence && known.timestamp === event.timestamp)) return;
  run.events.push(event);
  run.events.sort((left, right) => left.sequence - right.sequence || String(left.timestamp).localeCompare(String(right.timestamp)));
  run.status = deriveStatus(event, run.status);
  state.runs.set(run.runId, run);
  if (!state.selectedRunId) state.selectedRunId = run.runId;
}

function hydrateSnapshot(payload) {
  const runs = Array.isArray(payload) ? payload : Array.isArray(payload?.runs) ? payload.runs : [];
  for (const candidate of runs) {
    if (candidate?.events) {
      const run = state.runs.get(String(candidate.runId)) || { runId: String(candidate.runId), status: candidate.status || "running", events: [] };
      run.status = candidate.status || run.status;
      state.runs.set(run.runId, run);
      for (const event of candidate.events) upsertEvent({ ...event, runId: event.runId || run.runId });
    } else {
      upsertEvent(candidate);
    }
  }
}

function renderRuns() {
  const runs = [...state.runs.values()].sort((a, b) => (b.events.at(-1)?.timestamp || "").localeCompare(a.events.at(-1)?.timestamp || ""));
  elements.runCount.textContent = String(runs.length);
  elements.runList.replaceChildren();
  elements.runEmpty.hidden = runs.length > 0;
  for (const run of runs) {
    const button = document.createElement("button");
    button.className = "run-item"; button.type = "button"; button.role = "option";
    button.setAttribute("aria-selected", String(run.runId === state.selectedRunId));
    button.innerHTML = `<span class="run-status" data-status="${run.status}"></span><span class="run-name"><strong>${escapeHtml(run.runId)}</strong><small>${escapeHtml(run.status)} · ${run.events.length} event${run.events.length === 1 ? "" : "s"}</small></span><span class="event-count">${readableTime(run.events.at(-1)?.timestamp)}</span>`;
    button.addEventListener("click", () => { state.selectedRunId = run.runId; state.selectedEvent = null; render(); });
    elements.runList.append(button);
  }
}

function renderTimeline() {
  const run = state.runs.get(state.selectedRunId);
  const events = run?.events || [];
  elements.timeline.replaceChildren();
  elements.pause.disabled = !run;
  elements.timelineTitle.textContent = run ? run.runId : "Select a run";
  elements.timelineEmpty.hidden = events.length > 0;
  for (const event of events) {
    const entry = document.createElement("article"); entry.className = "timeline-entry";
    const selected = state.selectedEvent === event;
    entry.innerHTML = `<time class="event-time">${readableTime(event.timestamp)}</time><span class="event-marker" data-stream="${escapeHtml(event.stream)}"></span><button type="button" class="event-card" aria-selected="${selected}"><span class="event-meta"><span>${escapeHtml(event.type)} · ${escapeHtml(event.stream)}</span><span>#${event.sequence}</span></span><span class="event-text">${escapeHtml(event.text || "(structured event)")}</span></button>`;
    entry.querySelector("button").addEventListener("click", () => { state.selectedEvent = event; renderDetails(); renderTimeline(); });
    elements.timeline.append(entry);
  }
  if (!state.paused && events.length) elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function renderDetails() {
  const event = state.selectedEvent;
  if (!event) {
    elements.eventSummary.textContent = "Select an event to inspect its complete envelope.";
    elements.structured.textContent = "No event selected."; elements.raw.textContent = "No event selected.";
    return;
  }
  const envelope = { version: event.version, runId: event.runId, sequence: event.sequence, timestamp: event.timestamp, type: event.type, stream: event.stream, text: event.text, data: event.data };
  elements.eventSummary.textContent = `${event.type} from ${event.stream} · run ${event.runId} · sequence ${event.sequence}`;
  elements.structured.textContent = JSON.stringify(envelope, null, 2);
  elements.raw.textContent = JSON.stringify(envelope);
}

function render() { renderRuns(); renderTimeline(); renderDetails(); }
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }

function setDetailTab(raw) {
  elements.structuredTab.setAttribute("aria-selected", String(!raw)); elements.rawTab.setAttribute("aria-selected", String(raw));
  elements.structured.hidden = raw; elements.raw.hidden = !raw;
}

elements.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  elements.pause.setAttribute("aria-pressed", String(state.paused));
  elements.pause.textContent = state.paused ? "Resume" : "Pause";
  if (!state.paused) renderTimeline();
});
elements.structuredTab.addEventListener("click", () => setDetailTab(false));
elements.rawTab.addEventListener("click", () => setDetailTab(true));

async function start() {
  if (!token) { setConnection("offline", "Missing token"); return; }
  try {
    const response = await fetch(endpoint(snapshotPath), { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
    hydrateSnapshot(await response.json()); render();
  } catch (error) {
    setConnection("offline", "Snapshot unavailable");
    elements.timelineEmpty.querySelector("strong").textContent = "Could not load the live snapshot";
    elements.timelineEmpty.querySelector("span").textContent = error.message;
    return;
  }
  setConnection("connecting", "Connecting");
  const source = new EventSource(endpoint(eventsPath)); state.eventSource = source;
  source.onopen = () => setConnection("live", "Live");
  source.onmessage = (message) => { try { upsertEvent(JSON.parse(message.data)); render(); } catch { /* Ignore malformed transport data. */ } };
  source.onerror = () => setConnection("offline", "Reconnecting");
}

start();
