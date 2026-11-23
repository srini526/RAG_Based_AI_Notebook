import { useState } from "react";
import { FiArrowLeft } from "react-icons/fi";

import Panel from "./Panel.jsx";
import { PILL_BTN, PRIMARY_BTN } from "../hooks/Ui.js";

const FIELD = "w-full rounded-xl border border-[#E6E1D6] bg-white px-3 py-2.5 text-sm dark:border-[#35322F] dark:bg-[#141312]";

export default function NoteEditor({ note, onCancel, onSave }) {
  const [title, setTitle] = useState(note?.title || "");
  const [markdown, setMarkdown] = useState(note?.content?.markdown || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = title !== (note?.title || "") || markdown !== (note?.content?.markdown || "");

  const submit = async (event) => {
    event.preventDefault();
    if (!markdown.trim() || pending) return;
    setPending(true);
    setError("");
    try {
      await onSave({ title, markdown }, note?.id);
    } catch (err) {
      setError(err?.message || "Couldn't save the note. Try again.");
      setPending(false);
    }
  };

  return (
    <Panel title={note ? "Edit note" : "New note"} actions={
      <button type="button" onClick={() => {
        if (!dirty || window.confirm("Discard unsaved changes?")) onCancel();
      }} disabled={pending} className={PILL_BTN}>
        <FiArrowLeft size={14} /> Back
      </button>
    }>
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-6 sm:px-6">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Title</span>
          <input autoFocus className={FIELD} value={title} placeholder="Untitled note" maxLength={120}
            onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Note</span>
          <textarea className={`${FIELD} min-h-52 resize-y font-normal leading-relaxed`} value={markdown}
            placeholder="Write a note in plain text or Markdown" maxLength={30000}
            onChange={(event) => setMarkdown(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <button type="submit" className={PRIMARY_BTN} disabled={pending || !markdown.trim()}>
          {pending ? "Saving…" : "Save note"}
        </button>
      </form>
    </Panel>
  );
}
