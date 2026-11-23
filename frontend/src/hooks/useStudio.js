import { useEffect, useRef, useState } from "react";
import { deleteOutput, streamGenerate } from "../services/api";

const STUDIO_TIMEOUT_MS = 95_000;

/** Studio outputs of one notebook (saved on the server) plus the one being generated. */
export default function useStudio(nid, initialOutputs) {
  const [outputs, setOutputs] = useState(initialOutputs);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null); // { kind, text, steps, data, error }
  const [watching, setWatching] = useState(false); // is the reader looking at the draft being generated?
  const abortRef = useRef(null);
  const watchingRef = useRef(false);
  useEffect(() => () => abortRef.current?.abort(), []);

  const watch = (on) => {
    watchingRef.current = on;
    setWatching(on);
  };

  const generating = draft !== null && !draft.error;

  const generate = async (kind, docIds = [], topic = "") => {
    if (abortRef.current) return;
    const focus = topic.trim();
    setActiveId(null);
    watch(false);
    setDraft({ kind, docIds, focus, text: "", steps: [], data: null, error: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => abortRef.current === controller && !controller.signal.aborted;
    const patchDraft = (update) => {
      if (isCurrent()) setDraft((d) => (d ? update(d) : d));
    };
    const body = { kind, ...(docIds.length ? { doc_ids: docIds } : {}), ...(focus ? { focus } : {}) };
    const timeout = setTimeout(() => {
      patchDraft((d) => ({ ...d, error: "This took too long. Try again or select fewer sources." }));
      if (isCurrent()) {
        abortRef.current = null;
        controller.abort();
      }
    }, STUDIO_TIMEOUT_MS);
    try {
      await streamGenerate(nid, body, {
        signal: controller.signal,
        onStep: (step) => patchDraft((d) => ({ ...d, steps: [...d.steps, step] })),
        onToken: (token) => patchDraft((d) => ({ ...d, text: d.text + token })),
        onData: (key, value) => patchDraft((d) => ({ ...d, data: { [key]: value } })),
        onDone: (_sources, _meta, output) => {
          if (!isCurrent()) return;
          if (!output) {
            patchDraft((d) => ({ ...d, error: "Couldn't save this output. Try again." }));
            return;
          }
          setOutputs((o) => [output, ...o]);
          setActiveId((current) => (current === null && watchingRef.current ? output.id : current));
          setDraft(null);
        },
        onError: (err) => patchDraft((d) => ({ ...d, error: err.message })),
      });
    } catch {
      patchDraft((d) => ({ ...d, error: "Couldn't complete this request. Try again." }));
    } finally {
      clearTimeout(timeout);
      if (isCurrent()) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    watch(false);
    setDraft(null);
  };

  const remove = async (id) => {
    try {
      await deleteOutput(nid, id);
    } catch {
      return;
    }
    setOutputs((o) => o.filter((x) => x.id !== id));
    setActiveId((a) => (a === id ? null : a));
  };

  return {
    outputs,
    active: outputs.find((o) => o.id === activeId) || null,
    open: setActiveId,
    close: () => {
      setActiveId(null);
      watch(false);
    },
    dismiss: () => setDraft(null), // clear a failed generation
    addOutput: (output) => setOutputs((o) => [output, ...o.filter((x) => x.id !== output.id)]), // made from chat
    watching,
    watch,
    draft,
    generating,
    generate,
    retry: () => {
      if (draft?.error) generate(draft.kind, draft.docIds, draft.focus);
    },
    cancel,
    remove,
  };
}