import { useEffect, useRef, useState } from "react";
import { clearChat, streamChat } from "../services/api";

const newBotMessage = () => ({ sender: "bot", message: "", sources: [], steps: [], meta: null });

/** The notebook's single chat. The server saves finished answers; this hook streams new ones. */
export default function useChat(nid, initialMessages, { onOutput } = {}) {
  const [messages, setMessages] = useState(initialMessages);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("normal"); // answer style
  const abortRef = useRef(null);
  const replacing = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (update) =>
    setMessages((prev) => (prev.length ? [...prev.slice(0, -1), update(prev[prev.length - 1])] : prev));

  const sendMessage = async (question, docIds = [], previous = null) => {
    const q = question.trim();
    if (!q || abortRef.current) return;
    replacing.current = previous;
    setMessages((prev) => previous
      ? [...prev.slice(0, -1), newBotMessage()]
      : [...prev, { sender: "user", message: q }, newBotMessage()]);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    let text = "";
    const body = { question: q, mode, ...(docIds.length ? { doc_ids: docIds } : {}),
      ...(previous?.id ? { replace_answer_id: previous.id } : {}) };
    const fail = (err) => {
      const message = err?.message || "Couldn't generate a response. Try again.";
      patchLast(() => previous?.id ? { ...previous, retryError: message } : { sender: "bot", message, sources: [], error: true });
    };
    const timeout = setTimeout(() => {
      controller.abort();
      fail(new Error("The answer took too long. Try again."));
    }, 130_000);
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
        onOutput,
        onDone: (sources, meta) => patchLast((m) => ({ ...m, id: meta?.message_id, message: text, sources, meta })),
        onError: fail,
      });
    } finally {
      clearTimeout(timeout);
      replacing.current = null;
      abortRef.current = null;
      setLoading(false); // always unlock the input, whatever happened
    }
  };

  const stop = () => {
    if (!abortRef.current) return;
    abortRef.current?.abort();
    const previous = replacing.current;
    patchLast((m) => previous?.id ? previous : { ...m, stopped: true });
  };

  /** Ask the last question again and replace the answer. */
  const regenerate = async (docIds = []) => {
    if (loading) return;
    const last = messages.map((m) => m.sender).lastIndexOf("user");
    if (last < 0 || !messages[last + 1]) return;
    const question = messages[last].message;
    await sendMessage(question, docIds, messages[last + 1]);
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