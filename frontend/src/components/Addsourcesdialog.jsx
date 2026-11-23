import { useEffect, useRef, useState } from "react";
import { FiFileText, FiGlobe, FiLink, FiUploadCloud, FiX, FiYoutube } from "react-icons/fi";

import { ICON_BTN, PILL_BTN, PRIMARY_BTN } from "../hooks/Ui.js";

const FIELD = "w-full rounded-xl border border-[#D6CFC2] bg-white px-3 py-2 text-sm dark:border-[#35322F] dark:bg-[#141312]";

/** NotebookLM-style "Add sources" dialog: drop files or paste a link. */
export default function AddSourcesDialog({ config, showSample, onFiles, onLink, onSample, onClose }) {
  const fileInput = useRef(null);
  const closeRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [pasting, setPasting] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState("");

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submitLink = async () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    setLinkError("");
    try {
      await onLink(url.trim());
      onClose();
    } catch (err) {
      setLinkError(err?.message || "Couldn't add the link. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const takeFiles = (files) => {
    if (!files?.length) return;
    onFiles(files);
    onClose();
  };

  const submitText = (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    const title = textTitle.trim().replace(/[\\/]/g, "_") || "Pasted text";
    const file = new File([text], `${title}.txt`, { type: "text/plain" });
    if (file.size > Math.min(config.max_upload_mb, 5) * 1024 * 1024) {
      setTextError("This text is too large. Split it into smaller sources.");
      return;
    }
    takeFiles([file]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add sources"
        onClick={(e) => e.stopPropagation()}
        className="fade-up max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-[#E6E1D6] bg-[#FAF8F5] p-5 shadow-xl sm:rounded-3xl sm:p-6 dark:border-[#2A2826] dark:bg-[#1C1B19]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif-editorial text-xl font-medium text-[#1C1917] dark:text-[#F5F2EB]">Add sources</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#78716C] dark:text-[#A8A29E]">
              Answers and study material are built only from what you add here.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className={ICON_BTN}>
            <FiX size={17} />
          </button>
        </div>

        <div className="mt-4 flex gap-2" aria-label="Source input method">
          <button type="button" className={PILL_BTN} aria-pressed={!pasting} onClick={() => setPasting(false)}>File or link</button>
          <button type="button" className={PILL_BTN} aria-pressed={pasting} onClick={() => setPasting(true)}>Paste text</button>
        </div>

        {pasting ? (
          <form onSubmit={submitText} className="mt-4 space-y-3">
            <label className="block space-y-1 text-sm"><span>Source title (optional)</span>
              <input className={FIELD} value={textTitle} maxLength={100} placeholder="Pasted text"
                onChange={(event) => setTextTitle(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm"><span>Source text</span>
              <textarea className={`${FIELD} min-h-40 resize-y leading-relaxed`} value={text} required
                onChange={(event) => { setText(event.target.value); setTextError(""); }} />
            </label>
            {textError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{textError}</p>}
            <button type="submit" className={PRIMARY_BTN} disabled={!text.trim()}>Add text source</button>
          </form>
        ) : <>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInput.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFiles(e.dataTransfer.files);
          }}
          className={`mt-5 flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-4 py-9 text-center transition ${
            dragging
              ? "border-[#C85A32] bg-[#C85A32]/8 dark:border-[#D97757] dark:bg-[#D97757]/10"
              : "border-[#D6CFC2] hover:border-[#C85A32]/60 dark:border-[#35322F] dark:hover:bg-[#18120F] dark:bg-[#141312]/40 dark:hover:border-[#D97757]/60"
          }`}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-[#C85A32]/12 text-[#C85A32] dark:bg-[#D97757]/15 dark:text-[#D97757]">
            <FiUploadCloud size={22} />
          </span>
          <p className="mt-3 text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">Drop files here or click to upload</p>
          <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
            PDF, Word, Slides, TXT/MD{config.allowed_extensions.includes("png") && ", images"}, audio &amp; video
            {" · up to "}{config.max_upload_mb} MB
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={config.allowed_extensions.map((e) => `.${e}`).join(",")}
            className="hidden"
            onChange={(e) => {
              takeFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <FiLink size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#78716C]" />
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); setLinkError(""); }}
              onKeyDown={(e) => e.key === "Enter" && submitLink()}
              placeholder="Paste a YouTube or website link"
              aria-label="Link to add"
              className="w-full rounded-full border border-[#D6CFC2] bg-[#FFFFFF] py-2.5 pl-9 pr-4 text-sm text-[#1C1917] outline-none transition placeholder:text-[#A8A29E] focus:border-[#C85A32] focus:ring-3 focus:ring-[#C85A32]/12 dark:border-[#35322F] dark:bg-[#141312] dark:text-[#F5F2EB] dark:focus:border-[#D97757]"
            />
          </div>
          <button
            type="button"
            onClick={submitLink}
            disabled={adding || !url.trim()}
            className="cursor-pointer rounded-full bg-[#1C1917] px-5 text-sm font-medium text-[#FAF8F5] transition hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#F5F2EB] dark:text-[#141312]"
          >
            {adding ? "…" : "Add"}
          </button>
        </div>
        {linkError && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{linkError}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><FiFileText size={12} /> Documents</span>
            <span className="inline-flex items-center gap-1"><FiYoutube size={12} /> YouTube</span>
            <span className="inline-flex items-center gap-1"><FiGlobe size={12} /> Websites</span>
          </span>
          {showSample && (
            <button
              type="button"
              onClick={() => {
                onSample();
                onClose();
              }}
              className={`${PILL_BTN} !px-3 !py-1.5 !text-xs`}
            >
              Try a sample note
            </button>
          )}
        </div>
        </>}
      </div>
    </div>
  );
}