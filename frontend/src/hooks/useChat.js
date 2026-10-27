import { useRef, useState } from "react";
import { clearChat, streamChat } from "../services/api";

const newBotMessage = () => ({ sender: "bot", message: "", sources: [], steps: [], meta: null });

/** The notebook's single chat. The server saves finished answers; this hook streams new ones. */
export default function useChat(nid, initialMessages) {
  const [messages, setMessages] = useState(initialMessages);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("normal"); // answer style
  const abortRef = useRef(null);

  const patchLast = (update) =>
    setMessages((prev) => (prev.length ? [...prev.slice(0, -1), update(prev[prev.length - 1])] : prev));

  const sendMessage = async (question, docIds = []) => {
    const q = question.trim();
    if (!q || loading) return;
    setMessages((prev) => [...prev, { sender: "user", message: q }, newBotMessage()]);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    let text = "";
    const body = { question: q, mode, ...(docIds.length ? { doc_ids: docIds } : {}) };
    try {
      await streamChat(nid, body, {
        signal: controller.signal,
        onStep: (step) => patchLast((m) => ({ ...m, steps: [...(m.steps || []), step] })),
        onReset: () => {
          text = "";
          patchLast((m) => ({ ...m, message: "", revised: true }));
        },
        onToken: (token) => {
          text += token;
          patchLast((m) => ({ ...m, message: text }));
        },
        onDone: (sources, meta) => patchLast((m) => ({ ...m, message: text, sources, meta })),
        onError: (err) =>
          patchLast(() => ({
            sender: "bot",
            message: err?.message || "Sorry, something went wrong while generating the response.",
            sources: [],
            error: true,
          })),
      });
    } finally {
      abortRef.current = null;
      setLoading(false); // always unlock the input, whatever happened
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    patchLast((m) => ({ ...m, stopped: true }));
  };

  /** Ask the last question again and replace the answer. */
  const regenerate = async (docIds = []) => {
    if (loading) return;
    const last = messages.map((m) => m.sender).lastIndexOf("user");
    if (last < 0) return;
    const question = messages[last].message;
    setMessages((prev) => prev.slice(0, last));
    await sendMessage(question, docIds);
  };

  const clear = async () => {
    if (loading) return;
    try {
      await clearChat(nid);
      setMessages([]);
    } catch {
      // keep the chat on screen if the server could not clear it
    }
  };

  return { messages, loading, mode, setMode, sendMessage, stop, regenerate, clear };
}
