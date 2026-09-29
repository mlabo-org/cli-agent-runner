import { StringDecoder } from "node:string_decoder";

export const RUNNER_STREAM_FORMATS = new Set(["text", "ndjson", "messages-json"]);

export function createRunnerStreamAdapter(options = {}) {
  const format = options.format ?? "text";
  if (!RUNNER_STREAM_FORMATS.has(format)) {
    throw new TypeError(`unsupported runner stream format: ${format}`);
  }
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };
  const lineBuffers = { stdout: "", stderr: "" };
  const message = { deltas: [], snapshots: [], result: null, error: null };

  const emit = (event) => {
    if (event.text === "" && event.data === null) return;
    onEvent(event);
  };

  const consumeText = (stream, text) => {
    if (!text) return;
    if (format === "text" || stream === "stderr") {
      emit({ type: "runner.output", stream, text, data: null });
      return;
    }
    lineBuffers[stream] += text;
    const lines = lineBuffers[stream].split(/\r?\n/);
    lineBuffers[stream] = lines.pop() ?? "";
    for (const line of lines) consumeStructuredLine(stream, line);
  };

  const consumeStructuredLine = (stream, line) => {
    if (!line.trim()) return;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      emit({ type: "runner.output", stream, text: `${line}\n`, data: null });
      return;
    }
    const text = extractEventText(unwrapStreamEvent(data));
    if (format === "messages-json") captureMessageText(data, message);
    emit({ type: "runner.message", stream, text, data });
  };

  return {
    write(stream, chunk) {
      if (!Object.hasOwn(decoders, stream)) throw new TypeError(`unknown runner stream: ${stream}`);
      consumeText(stream, decoders[stream].write(chunk));
    },
    end(stream) {
      if (!Object.hasOwn(decoders, stream)) throw new TypeError(`unknown runner stream: ${stream}`);
      consumeText(stream, decoders[stream].end());
      if (format !== "text" && stream === "stdout" && lineBuffers.stdout) {
        consumeStructuredLine("stdout", lineBuffers.stdout);
        lineBuffers.stdout = "";
      }
    },
    // The final answer is the provider's result line when it emits one,
    // otherwise the last assistant message only; earlier turns are progress.
    resultText() {
      if (format !== "messages-json") return "";
      if (message.result !== null) return message.result.trim();
      const text = message.deltas.length ? message.deltas.join("") : message.snapshots.at(-1) ?? "";
      return text.trim();
    },
    reportedError() {
      return format === "messages-json" ? message.error : null;
    },
  };
}

// Grok and Claude-style streams wrap Anthropic Messages events as
// {"type":"stream_event","event":{...}}; bare events are accepted too.
function unwrapStreamEvent(data) {
  return data?.type === "stream_event" && data.event && typeof data.event === "object" ? data.event : data;
}

function captureMessageText(data, message) {
  if (!data || typeof data !== "object") return;
  if (data.type === "result") {
    if (typeof data.result === "string") message.result = data.result;
    if (data.is_error === true) message.error = singleLineText(data.result) || "provider reported an error result";
    return;
  }
  const event = unwrapStreamEvent(data);
  if (event.type === "message_start") {
    message.deltas = [];
    return;
  }
  if (event.type === "content_block_delta") {
    if (typeof event.delta?.text === "string") message.deltas.push(event.delta.text);
    return;
  }
  const content = event.message?.content ?? event.content;
  if (!Array.isArray(content)) return;
  const text = content
    .filter((block) => block && typeof block === "object" && block.type !== "thinking" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (text) message.snapshots.push(text);
}

function singleLineText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function extractEventText(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.delta?.text === "string") return data.delta.text;
  if (typeof data.text === "string") return data.text;
  const content = data.message?.content ?? data.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block) => block && typeof block === "object" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  return text || null;
}
