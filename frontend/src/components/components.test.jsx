// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api", () => ({
  getConfig: vi.fn(async () => ({ allowed_extensions: ["pdf", "md"], max_upload_mb: 100, max_docs: 10 })),
  listLibrary: vi.fn(async () => []),
  renameNotebook: vi.fn(async () => ({ ok: true })),
  deleteOutput: vi.fn(async () => ({ ok: true })),
  clearChat: vi.fn(async () => ({ ok: true })),
  uploadFile: vi.fn(),
  addUrl: vi.fn(),
  deleteDoc: vi.fn(),
  clearLibrary: vi.fn(),
  streamChat: vi.fn(),
  streamGenerate: vi.fn(),
}));

import { streamChat, streamGenerate } from "../services/api";
import Flashcards from "./Flashcards";
import Markdown from "./Markdown";
import MindMap from "./MindMap";
import NotebookView from "./NotebookView";
import Quiz from "./Quiz";

const SOURCE = { id: "S1", title: "notes.md", kind: "text", locator: "Closures", url: "", text: "A closure remembers its scope.", snippet: "A closure…" };

const DATA = {
  notebook: { id: "n".repeat(32), title: "Biology" },
  documents: [{
    id: "d1", name: "notes.md", kind: "text", status: "ready", chunks: 3, source: "",
    guide: { summary: "All about closures.", topics: ["scope"], questions: ["What is a closure?"] },
  }],
  messages: [],
  outputs: [{ id: "o1", kind: "briefing", title: "Briefing doc", created_at: Date.now() / 1000,
              content: { markdown: "Saved briefing [S1].", sources: [SOURCE] } }],
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // not implemented in jsdom
  window.confirm = vi.fn(() => true);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("citations", () => {
  it("turns [S1] into a button that opens the source", async () => {
    const onCite = vi.fn();
    render(<Markdown sources={[SOURCE]} onCite={onCite}>{"A closure keeps scope [S1] and more [S9]."}</Markdown>);
    expect(await screen.findByRole("button", { name: /open source 1/i })).toBeTruthy();
    expect(screen.getByText(/\[S9\]/)).toBeTruthy(); // unknown ids stay plain text
    await userEvent.click(screen.getByRole("button", { name: /open source 1/i }));
    expect(onCite).toHaveBeenCalledWith(SOURCE);
  });

  it("does not render javascript: links", async () => {
    render(<Markdown sources={[]}>{"[click](javascript:alert(1))"}</Markdown>);
    const link = await screen.findByText("click");
    expect(link.closest("a")?.getAttribute("href") || "").not.toContain("javascript");
  });
});

describe("Studio widgets", () => {
  it("renders a mind map with all labels", () => {
    render(<MindMap map={{ title: "Closures", branches: [{ label: "Scope", children: ["lexical", "outer"] }, { label: "Uses", children: [] }] }} />);
    for (const label of ["Closures", "Scope", "lexical", "outer", "Uses"]) expect(screen.getByText(label)).toBeTruthy();
  });

  it("flips and steps through flashcards", async () => {
    render(<Flashcards cards={[{ front: "Closure?", back: "Function + scope" }, { front: "Base case?", back: "Stops recursion" }]} />);
    expect(screen.getByText("Closure?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /show the answer/i }));
    expect(screen.getByText("Function + scope")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /next card/i }));
    expect(screen.getByText("Base case?")).toBeTruthy();
  });

  it("scores a quiz", async () => {
    render(<Quiz quiz={{ questions: [{ question: "Q1", options: ["a", "b"], answer_index: 1, explanation: "Because b." }] }} />);
    await userEvent.click(screen.getByRole("button", { name: "b" }));
    expect(screen.getByText("Because b.")).toBeTruthy();
    expect(screen.getByText(/Score: 1 \/ 1/)).toBeTruthy();
  });
});

describe("NotebookView", () => {
  const view = () => render(<NotebookView nid={DATA.notebook.id} data={DATA} theme={null} onHome={() => {}} />);

  it("shows sources with their guide, the studio and saved outputs", async () => {
    view();
    expect(screen.getByRole("heading", { name: /sources \(1\/10\)/i })).toBeTruthy();
    expect(screen.getByText("Saved outputs")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Source guide" }));
    expect(screen.getByText("All about closures.")).toBeTruthy();
    expect(screen.getAllByText("What is a closure?").length).toBeGreaterThan(0); // starter + guide question
  });

  it("asks a guide question, streams the answer and lets you open the cited passage", async () => {
    streamChat.mockImplementation(async (_nid, _body, h) => {
      h.onStep({ id: "retrieve", label: "Searching" });
      h.onToken("A closure remembers scope [S1].");
      h.onDone([SOURCE], { mode: "library" });
    });
    view();
    await userEvent.click(screen.getAllByText("What is a closure?")[0]);
    expect(streamChat).toHaveBeenCalledWith(DATA.notebook.id, expect.objectContaining({ question: "What is a closure?" }), expect.anything());
    await userEvent.click(await screen.findByRole("button", { name: /open source 1/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("A closure remembers its scope.");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("generates a quiz in the Studio and shows it", async () => {
    streamGenerate.mockImplementation(async (_nid, _body, h) => {
      h.onStep({ id: "read", label: "Reading" });
      h.onData("quiz", { questions: [{ question: "Pick one", options: ["x", "y"], answer_index: 0 }] });
      h.onDone([], { kind: "quiz" }, { id: "o2", kind: "quiz", title: "Quiz", created_at: Date.now() / 1000,
        content: { quiz: { questions: [{ question: "Pick one", options: ["x", "y"], answer_index: 0 }] } } });
    });
    view();
    await userEvent.click(screen.getByRole("button", { name: "Quiz" }));
    expect(streamGenerate).toHaveBeenCalledWith(DATA.notebook.id, { kind: "quiz" }, expect.anything());
    expect(await screen.findByText(/Pick one/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: /studio/i })[0]); // the viewer's back button
    expect(await screen.findByText("Saved outputs")).toBeTruthy();
  });

  it("limits chat and Studio to ticked sources", async () => {
    streamGenerate.mockImplementation(async (_n, _b, h) => h.onDone([], {}, null));
    view();
    await userEvent.click(screen.getByRole("checkbox", { name: /ask only about notes.md/i }));
    await userEvent.click(screen.getByRole("button", { name: "FAQ" }));
    expect(streamGenerate).toHaveBeenCalledWith(DATA.notebook.id, { kind: "faq", doc_ids: ["d1"] }, expect.anything());
  });

  it("shows an error message and unlocks the input when generation fails", async () => {
    streamChat.mockImplementation(async (_n, _b, h) => h.onError(new Error("AI is down")));
    view();
    await userEvent.click(screen.getAllByText("What is a closure?")[0]);
    expect(await screen.findByText("AI is down")).toBeTruthy();
    expect(screen.getByLabelText("Your question").disabled).toBe(false);
  });
});
