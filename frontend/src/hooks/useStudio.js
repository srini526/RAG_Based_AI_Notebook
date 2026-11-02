import { useRef, useState } from "react";
import { deleteOutput, streamGenerate } from "../services/api";

/** Studio outputs of one notebook (saved on the server) plus the one being generated. */
export default function useStudio(nid, initialOutputs) {
  const [outputs, setOutputs] = useState(initialOutputs);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null); // { kind, text, steps, data, error }
  const [watching, setWatching] = useState(false); // is the reader looking at the draft being generated?
  const abortRef = useRef(null);
  const watchingRef = useRef(false);

  const watch = (on) => {
    watchingRef.current = on;
    setWatching(on);
  };

  const patchDraft = (update) => setDraft((d) => (d ? update(d) : d));
  const generating = draft !== null && !draft.error;

  const generate = async (kind, docIds = []) => {
    if (generating) return;
    setActiveId(null);
    watch(false);
    setDraft({ kind, text: "", steps: [], data: null, error: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    await streamGenerate(nid, { kind, ...(docIds.length ? { doc_ids: docIds } : {}) }, {
      signal: controller.signal,
      onStep: (step) => patchDraft((d) => ({ ...d, steps: [...d.steps, step] })),
      onToken: (token) => patchDraft((d) => ({ ...d, text: d.text + token })),
      onData: (key, value) => patchDraft((d) => ({ ...d, data: { [key]: value } })),
      onDone: (_sources, _meta, output) => {
        if (output) {
          setOutputs((o) => [output, ...o]);
          // Like NotebookLM: the new item lands in the list; it opens only if you were watching it.
          setActiveId((current) => (current === null && watchingRef.current ? output.id : current));
        }
        setDraft(null);
      },
      onError: (err) => setDraft((d) => ({ ...(d || { kind, text: "", steps: [], data: null }), error: err.message })),
    });
    abortRef.current = null;
  };

  const cancel = () => {
    abortRef.current?.abort();
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
    cancel,
    remove,
  };
}