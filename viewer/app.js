import {
  DEFAULT_EVENT_WINDOW,
  EVENT_WINDOW_STEP,
  buildTimelineView,
  isErrorEvent,
  isLowInformationEvent,
} from "./timeline-model.js";

const query = new URLSearchParams(window.location.search);
const token = query.get("token");
const apiBase = new URL(query.get("apiBase") || ".", window.location.href);
const snapshotPath = query.get("snapshotPath") || "/api/snapshot";
const eventsPath = query.get("eventsPath") || "/api/events";
const configuredCodeFontSize = Number(query.get("codeFontSize"));
if (Number.isFinite(configuredCodeFontSize) && configuredCodeFontSize >= 10 && configuredCodeFontSize <= 32) {
  document.documentElement.style.setProperty("--console-code-font-size", `${configuredCodeFontSize}px`);
}

const elements = {
  connection: document.querySelector("#connection"), connectionLabel: document.querySelector("#connection-label"),
  runCount: document.querySelector("#run-count"), runList: document.querySelector("#run-list"), runEmpty: document.querySelector("#run-empty"),
  timeline: document.querySelector("#timeline"), timelineEmpty: document.querySelector("#timeline-empty"), timelineTitle: document.querySelector("#timeline-title"),
  timelineStats: document.querySelector("#timeline-stats"), follow: document.querySelector("#follow-button"),
  filterButtons: [...document.querySelectorAll("[data-filter]")], eventSummary: document.querySelector("#event-summary"),
  structured: document.querySelector("#structured-payload"), raw: document.querySelector("#raw-payload"),
  structuredTab: document.querySelector("#structured-tab"), rawTab: document.querySelector("#raw-tab"),
};

const state = {
  runs: new Map(), selectedRunId: null, selectedEvent: null, eventSource: null,
  timelineFilter: "all", visibleEventCount: DEFAULT_EVENT_WINDOW, followLatest: true,
  expandedGroups: new Set(), renderFrame: null, suppressTimelineScroll: false, timelineRenderVersion: 0,
};

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
    button.addEventListener("click", () => {
      state.selectedRunId = run.runId;
      state.selectedEvent = null;
      resetTimelineView();
      render();
    });
    elements.runList.append(button);
  }
}

function renderTimeline(options = {}) {
  const renderVersion = ++state.timelineRenderVersion;
  state.suppressTimelineScroll = true;
  const priorScrollTop = elements.timeline.scrollTop;
  const priorScrollHeight = elements.timeline.scrollHeight;
  const run = state.runs.get(state.selectedRunId);
  const events = run?.events || [];
  const view = buildTimelineView(events, { filter: state.timelineFilter, visibleCount: state.visibleEventCount });
  elements.timeline.replaceChildren();
  elements.follow.disabled = !run;
  elements.timelineTitle.textContent = run ? run.runId : "Select a run";
  updateTimelineToolbar(view, Boolean(run));

  const hasVisibleEvents = view.visibleEventCount > 0;
  elements.timelineEmpty.hidden = hasVisibleEvents;
  if (!hasVisibleEvents) updateTimelineEmpty(Boolean(run), view);

  if (view.hiddenEventCount > 0) elements.timeline.append(createRevealOlder(view.hiddenEventCount));
  for (const item of view.items) {
    if (item.kind === "group") renderGroup(item);
    else elements.timeline.append(createEventEntry(item.event));
  }

  if (state.followLatest && hasVisibleEvents) {
    elements.timeline.scrollTop = elements.timeline.scrollHeight;
  } else if (options.preserveAnchor) {
    elements.timeline.scrollTop = priorScrollTop + (elements.timeline.scrollHeight - priorScrollHeight);
  } else {
    elements.timeline.scrollTop = priorScrollTop;
  }
  requestAnimationFrame(() => {
    if (state.timelineRenderVersion === renderVersion) state.suppressTimelineScroll = false;
  });
}

function updateTimelineToolbar(view, hasRun) {
  const parts = state.timelineFilter === "all"
    ? [`${view.visibleEventCount} visible`, `${view.totalEventCount} total`]
    : [`${view.visibleEventCount} visible`, `${view.filteredEventCount} ${state.timelineFilter}`, `${view.totalEventCount} total`];
  if (view.hiddenEventCount) parts.unshift(`${view.hiddenEventCount} older hidden`);
  elements.timelineStats.textContent = hasRun ? parts.join(" · ") : "0 events";
  for (const button of elements.filterButtons) {
    const active = button.dataset.filter === state.timelineFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !hasRun;
  }
  updateFollowControl();
}

function updateTimelineEmpty(hasRun, view) {
  const strong = elements.timelineEmpty.querySelector("strong");
  const detail = elements.timelineEmpty.querySelector("span");
  if (!hasRun) {
    strong.textContent = "Waiting for activity";
    detail.textContent = "Choose a run, then its process events will stream here in sequence.";
  } else if (view.totalEventCount === 0) {
    strong.textContent = "Run is waiting";
    detail.textContent = "New process events will appear here.";
  } else {
    strong.textContent = `No ${state.timelineFilter} events`;
    detail.textContent = "Choose another filter to restore the chronological view.";
  }
}

function createRevealOlder(hiddenCount) {
  const wrapper = document.createElement("div");
  wrapper.className = "timeline-reveal";
  const button = document.createElement("button");
  const nextCount = Math.min(EVENT_WINDOW_STEP, hiddenCount);
  button.type = "button";
  button.className = "reveal-button";
  button.textContent = `Show ${nextCount} older event${nextCount === 1 ? "" : "s"}`;
  button.addEventListener("click", () => {
    state.followLatest = false;
    state.visibleEventCount += EVENT_WINDOW_STEP;
    renderTimeline({ preserveAnchor: true });
  });
  wrapper.append(button);
  return wrapper;
}

function renderGroup(group) {
  const expanded = state.expandedGroups.has(group.id);
  const entry = document.createElement("article");
  entry.className = "timeline-entry timeline-group";
  entry.innerHTML = `<time class="event-time">${readableTime(group.first.timestamp)}–${readableTime(group.last.timestamp)}</time><span class="event-marker" data-stream="structured"></span><button type="button" class="event-card group-card" aria-expanded="${expanded}"><span class="event-meta"><span>structured · ${escapeHtml(group.first.stream)}</span><span>#${group.first.sequence}–#${group.last.sequence}</span></span><span class="event-text">${group.events.length} low-information provider events</span><span class="group-hint">${expanded ? "Collapse grouped envelopes" : "Expand to inspect individual envelopes"}</span></button>`;
  entry.querySelector("button").addEventListener("click", () => {
    if (expanded) state.expandedGroups.delete(group.id);
    else state.expandedGroups.add(group.id);
    renderTimeline();
  });
  elements.timeline.append(entry);
  if (expanded) {
    for (const event of group.events) elements.timeline.append(createEventEntry(event, true));
  }
}

function createEventEntry(event, groupChild = false) {
  const entry = document.createElement("article");
  const selected = state.selectedEvent === event;
  const kind = isErrorEvent(event) ? "error" : isLowInformationEvent(event) ? "structured" : "signal";
  entry.className = `timeline-entry${groupChild ? " is-group-child" : ""}`;
  entry.dataset.kind = kind;
  entry.innerHTML = `<time class="event-time">${readableTime(event.timestamp)}</time><span class="event-marker" data-stream="${escapeHtml(event.stream)}"></span><button type="button" class="event-card" aria-selected="${selected}"><span class="event-meta"><span>${escapeHtml(event.type)} · ${escapeHtml(event.stream)}</span><span>#${event.sequence}</span></span><span class="event-text">${escapeHtml(event.text || "Structured provider event")}</span></button>`;
  entry.querySelector("button").addEventListener("click", () => {
    state.selectedEvent = event;
    renderDetails();
    renderTimeline();
  });
  return entry;
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
function scheduleRender() {
  if (state.renderFrame !== null) return;
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = null;
    render();
  });
}
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }

function resetTimelineView() {
  state.timelineFilter = "all";
  state.visibleEventCount = DEFAULT_EVENT_WINDOW;
  state.followLatest = true;
  state.expandedGroups.clear();
}

function updateFollowControl() {
  elements.follow.setAttribute("aria-pressed", String(state.followLatest));
  elements.follow.textContent = state.followLatest ? "Following latest" : "Follow latest";
}

function setDetailTab(raw) {
  elements.structuredTab.setAttribute("aria-selected", String(!raw)); elements.rawTab.setAttribute("aria-selected", String(raw));
  elements.structured.hidden = raw; elements.raw.hidden = !raw;
}

for (const button of elements.filterButtons) {
  button.addEventListener("click", () => {
    state.timelineFilter = button.dataset.filter;
    state.visibleEventCount = DEFAULT_EVENT_WINDOW;
    state.expandedGroups.clear();
    renderTimeline();
  });
}
elements.follow.addEventListener("click", () => {
  state.followLatest = true;
  updateFollowControl();
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
});
elements.timeline.addEventListener("scroll", () => {
  if (state.suppressTimelineScroll) return;
  const isNearBottom = elements.timeline.scrollHeight - elements.timeline.scrollTop - elements.timeline.clientHeight < 32;
  if (state.followLatest !== isNearBottom) {
    state.followLatest = isNearBottom;
    updateFollowControl();
  }
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
  source.onmessage = (message) => { try { upsertEvent(JSON.parse(message.data)); scheduleRender(); } catch { /* Ignore malformed transport data. */ } };
  source.onerror = () => setConnection("offline", "Reconnecting");
}

start();
