import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatToMarkdown } from "../utils/exportChat";
import { streamPost } from "./api";

const enc = new TextEncoder();

function sseResponse(chunks, status = 200) {
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(enc.encode(c)));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function collect() {
  const log = { steps: [], tokens: [], done: null, error: null, quiz: null };
  return {
    log,
    handlers: {
      onStep: (s) => log.steps.push(s.id),
      onToken: (t) => log.tokens.push(t),
      onData: (key, value) => key === "quiz" && (log.quiz = value),
      onDone: (sources, meta) => (log.done = { sources, meta }),
      onError: (e) => (log.error = e),
    },
  };
}

beforeEach(() => {
  const store = { rag_owner_key: "a".repeat(32) };
  vi.stubGlobal("localStorage", {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => (store[k] = v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("streamPost", () => {
  it("parses steps, tokens and done, even when an event is split across chunks", async () => {
    const lines = [
      'data: {"step": {"id": "analyze", "label": "x"}}\n\n',
      'data: {"token": "Hel',
      'lo"}\n\ndata: {"token": " world"}\n\n',
      'data: {"done": true, "sources": [{"id": "S1"}], "meta": {"mode": "library"}}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(lines)));
    const { log, handlers } = collect();
    await streamPost("/api/chat/stream", "n".repeat(32), { question: "q" }, handlers);
    expect(log.steps).toEqual(["analyze"]);
    expect(log.tokens.join("")).toBe("Hello world");
    expect(log.done).toEqual({ sources: [{ id: "S1" }], meta: { mode: "library" } });
    expect(log.error).toBeNull();
  });

  it("delivers quiz events", async () => {
    const quiz = { questions: [{ question: "Q", options: ["a", "b"], answer_index: 0 }] };
    vi.stubGlobal("fetch", vi.fn(async () =>
      sseResponse([`data: ${JSON.stringify({ quiz })}\n\n`, 'data: {"done": true}\n\n'])));
    const { log, handlers } = collect();
    await streamPost("/api/generate", "n".repeat(32), { kind: "quiz" }, handlers);
    expect(log.quiz).toEqual(quiz);
  });

  it("sends the device key and notebook id as headers", async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"done": true}\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await streamPost("/x", "n".repeat(32), {}, {});
    const sent = fetchMock.mock.calls[0][1].headers;
    expect(sent["X-Owner-Key"]).toBe("a".repeat(32));
    expect(sent["X-Notebook-Id"]).toBe("n".repeat(32));
  });

  it("reports server error events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(['data: {"error": "AI is down"}\n\n'])));
    const { log, handlers } = collect();
    await streamPost("/x", "n".repeat(32), {}, handlers);
    expect(log.error.message).toBe("AI is down");
  });

  it("reports a stream that ends without done (so the UI cannot hang)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(['data: {"token": "partial"}\n\n'])));
    const { log, handlers } = collect();
    await streamPost("/x", "n".repeat(32), {}, handlers);
    expect(log.error.code).toBe("stream_interrupted");
  });

  it("turns HTTP errors into ApiError with the server's code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "not_found", message: "Gone" } }), { status: 404 })));
    const { log, handlers } = collect();
    await streamPost("/x", "n".repeat(32), {}, handlers);
    expect(log.error.isNotFound).toBe(true);
  });

  it("stays silent when the request is aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }));
    const { log, handlers } = collect();
    await streamPost("/x", "n".repeat(32), {}, handlers);
    expect(log.error).toBeNull();
  });
});

describe("chatToMarkdown", () => {
  it("includes answers, quiz answers and sources", () => {
    const md = chatToMarkdown({
      title: "Closures",
      messages: [
        { sender: "user", message: "What is a closure?" },
        {
          sender: "bot",
          message: "A function with memory [S1].",
          sources: [{ id: "S1", title: "notes.md", locator: "Closures", url: "" }],
          quiz: { questions: [{ question: "Q?", options: ["a", "b"], answer_index: 1, explanation: "Because." }] },
        },
      ],
    });
    expect(md).toContain("# Closures");
    expect(md).toContain("**You:** What is a closure?");
    expect(md).toContain("**b** (correct)");
    expect(md).toContain("- [S1] notes.md (Closures)");
  });
});
