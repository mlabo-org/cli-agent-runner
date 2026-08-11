import assert from "node:assert/strict";
import test from "node:test";

import { buildTimelineView, isErrorEvent, isLowInformationEvent } from "../viewer/timeline-model.js";

test("timeline groups consecutive low-information runner messages without losing event objects", () => {
  const events = [
    event(1, { type: "run.started", stream: "system", text: "started" }),
    event(2), event(3), event(4),
    event(5, { text: "Working" }),
    event(6), event(7),
  ];
  const view = buildTimelineView(events, { visibleCount: 20 });
  assert.deepEqual(view.items.map((item) => item.kind), ["event", "group", "event", "group"]);
  assert.deepEqual(view.items[1].events, events.slice(1, 4));
  assert.deepEqual(view.items[3].events, events.slice(5, 7));
  assert.equal(view.visibleEventCount, 7);
  assert.equal(view.hiddenEventCount, 0);
});

test("timeline window and filters report visible, hidden, filtered, and total counts", () => {
  const events = [
    event(1),
    event(2, { text: "visible progress" }),
    event(3, { stream: "stderr", text: "warning" }),
    event(4),
    event(5, { type: "run.failed", stream: "system", text: "failed" }),
  ];
  const all = buildTimelineView(events, { visibleCount: 3 });
  assert.deepEqual(all.visibleEvents, events.slice(2));
  assert.deepEqual({ total: all.totalEventCount, filtered: all.filteredEventCount, visible: all.visibleEventCount, hidden: all.hiddenEventCount }, { total: 5, filtered: 5, visible: 3, hidden: 2 });

  const signal = buildTimelineView(events, { filter: "signal", visibleCount: 20 });
  assert.deepEqual(signal.visibleEvents, [events[1], events[2], events[4]]);
  const errors = buildTimelineView(events, { filter: "errors", visibleCount: 20 });
  assert.deepEqual(errors.visibleEvents, [events[2], events[4]]);
  assert.equal(isLowInformationEvent(events[0]), true);
  assert.equal(isErrorEvent(events[4]), true);
});

function event(sequence, overrides = {}) {
  return {
    version: 1,
    runId: "run-a",
    sequence,
    timestamp: `2026-08-11T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    type: "runner.message",
    stream: "stdout",
    text: "",
    data: { sequence },
    ...overrides,
  };
}
