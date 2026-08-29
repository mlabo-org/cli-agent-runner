export const DEFAULT_EVENT_WINDOW = 120;
export const EVENT_WINDOW_STEP = 120;
export const TIMELINE_FILTERS = new Set(["all", "signal", "errors"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Resolve viewer API configuration without ever crossing the viewer origin. */
export function resolveLoopbackBase(value, locationHref) {
  const location = new URL(locationHref);
  if (!LOOPBACK_HOSTS.has(location.hostname)) return new URL(location.origin);
  try {
    const candidate = new URL(value || ".", location);
    return candidate.origin === location.origin && LOOPBACK_HOSTS.has(candidate.hostname)
      ? new URL(`${candidate.origin}${candidate.pathname.endsWith("/") ? candidate.pathname : `${candidate.pathname}/`}`)
      : new URL(location.origin);
  } catch {
    return new URL(location.origin);
  }
}

export function resolveLoopbackEndpoint(value, baseHref, fallbackPath) {
  const base = new URL(baseHref);
  const candidate = new URL(value || fallbackPath, base);
  if (candidate.origin !== base.origin || !LOOPBACK_HOSTS.has(candidate.hostname)) {
    throw new Error("Live Console endpoint must remain on the loopback viewer origin");
  }
  return candidate;
}

export function isLowInformationEvent(event) {
  return event?.type === "runner.message"
    && event?.stream !== "stderr"
    && String(event?.text ?? "").trim() === "";
}

export function isErrorEvent(event) {
  return event?.stream === "stderr" || /fail|error|timeout|cancel/i.test(String(event?.type ?? ""));
}

export function buildTimelineView(events, options = {}) {
  const sourceEvents = Array.isArray(events) ? events : [];
  const filter = TIMELINE_FILTERS.has(options.filter) ? options.filter : "all";
  const visibleCount = Number.isSafeInteger(options.visibleCount) && options.visibleCount > 0
    ? options.visibleCount
    : DEFAULT_EVENT_WINDOW;
  const filteredEvents = sourceEvents.filter((event) => matchesFilter(event, filter));
  const hiddenEventCount = Math.max(0, filteredEvents.length - visibleCount);
  const visibleEvents = filteredEvents.slice(hiddenEventCount);

  return {
    filter,
    totalEventCount: sourceEvents.length,
    filteredEventCount: filteredEvents.length,
    visibleEventCount: visibleEvents.length,
    hiddenEventCount,
    visibleEvents,
    items: groupLowInformationEvents(visibleEvents),
  };
}

function matchesFilter(event, filter) {
  if (filter === "signal") return !isLowInformationEvent(event);
  if (filter === "errors") return isErrorEvent(event);
  return true;
}

function groupLowInformationEvents(events) {
  const items = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    if (pending.length === 1) {
      items.push({ kind: "event", event: pending[0] });
    } else {
      const first = pending[0];
      const last = pending.at(-1);
      items.push({
        kind: "group",
        id: `${first.runId}:${first.sequence}-${last.sequence}`,
        events: pending,
        first,
        last,
      });
    }
    pending = [];
  };

  for (const event of events) {
    const previous = pending.at(-1);
    const joinsPending = isLowInformationEvent(event)
      && (!previous || (
        previous.type === event.type
        && previous.stream === event.stream
        && Number(previous.sequence) + 1 === Number(event.sequence)
      ));
    if (joinsPending) {
      pending.push(event);
      continue;
    }
    flush();
    if (isLowInformationEvent(event)) pending.push(event);
    else items.push({ kind: "event", event });
  }
  flush();
  return items;
}
