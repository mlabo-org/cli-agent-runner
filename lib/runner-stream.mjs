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
  const messageDeltas = [];
  const messageSnapshots = [];

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
    const text = extractEventText(data);
    if (format === "messages-json") captureMessageText(data, messageDeltas, messageSnapshots);
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
    resultText() {
      if (format !== "messages-json") return "";
      const text = messageDeltas.length ? messageDeltas.join("") : messageSnapshots.at(-1) ?? "";
      return text.trim();
    },
  };
}

function captureMessageText(data, deltas, snapshots) {
  if (!data || typeof data !== "object") return;
  if (data.type === "content_block_delta" && typeof data.delta?.text === "string") {
    deltas.push(data.delta.text);
    return;
  }
  const content = data.message?.content ?? data.content;
  if (!Array.isArray(content)) return;
  const text = content
    .filter((block) => block && typeof block === "object" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (text) snapshots.push(text);
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
