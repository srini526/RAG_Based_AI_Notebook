import { useRef, useState } from "react";
import {
  FiAlertCircle,
  FiFileText,
  FiFilm,
  FiGlobe,
  FiLink,
  FiLoader,
  FiMonitor,
  FiMusic,
  FiTrash2,
  FiUploadCloud,
  FiYoutube,
} from "react-icons/fi";

const KIND_ICON = {
  pdf: FiFileText,
  docx: FiFileText,
  text: FiFileText,
  pptx: FiMonitor,
  audio: FiMusic,
  video: FiFilm,
  youtube: FiYoutube,
  web: FiGlobe,
};

function DocRow({ doc, selected, onToggle, onRemove, onAsk }) {
  const [showGuide, setShowGuide] = useState(false);
  const Icon = KIND_ICON[doc.kind] || FiFileText;
  const working = doc.status === "queued" || doc.status === "processing";

  return (
    <li className="group flex items-start gap-2.5 rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] px-3 py-2.5 shadow-2xs transition-all duration-150 hover:border-[#D6CFC2] dark:border-[#2A2826] dark:bg-[#22201E] dark:hover:border-[#3A3734]">
      {doc.status === "ready" && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(doc.id)}
          aria-label={`Ask only about ${doc.name}`}
          title="Ask only about this source"
          className="mt-2 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#C85A32]"
        />
      )}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F3EFEA] text-[#57534E] dark:bg-[#2C2926] dark:text-[#A8A29E]">
        <Icon size={14} />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB]"
          title={doc.name}
        >
          {doc.name}
        </p>

        {working && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#C85A32] dark:text-[#D97757]">
            <FiLoader className="animate-spin" size={11} />
            <span>{doc.message || "Queued…"}</span>
          </p>
        )}

        {doc.status === "error" && (
          <p className="mt-0.5 flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400">
            <FiAlertCircle className="mt-0.5 shrink-0" size={11} />
            <span>{doc.message}</span>
          </p>
        )}

        {doc.status === "ready" && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <span>Ready · {doc.chunks} passages</span>
          </p>
        )}

        {doc.guide && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              aria-expanded={showGuide}
              className="cursor-pointer text-[11px] font-medium text-[#C85A32] hover:underline dark:text-[#D97757]"
            >
              {showGuide ? "Hide source guide" : "Source guide"}
            </button>
            {showGuide && (
              <div className="mt-1.5 space-y-2 text-[11px] leading-relaxed text-[#57534E] dark:text-[#A8A29E]">
                <p>{doc.guide.summary}</p>
                {doc.guide.topics?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {doc.guide.topics.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-[#F3EFEA] px-2 py-0.5 text-[10px] text-[#57534E] dark:bg-[#2C2926] dark:text-[#A8A29E]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {doc.guide.questions?.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onAsk?.(q)}
                    className="block w-full cursor-pointer rounded-lg border border-[#E6E1D6] px-2 py-1.5 text-left text-[11px] text-[#292524] hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:text-[#E7E5E4] dark:hover:border-[#D97757]/60"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={() => onRemove(doc.id)}
        aria-label={`Remove ${doc.name}`}
        className="shrink-0 rounded-lg p-1.5 text-[#A8A29E] opacity-80 transition hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100 dark:text-[#78716C] dark:hover:text-red-400 cursor-pointer"
      >
        <FiTrash2 size={13} />
      </button>
    </li>
  );
}

export default function LibraryPanel({
  docs,
  uploads,
  config,
  error,
  clearError,
  onFiles,
  onLink,
  onRemove,
  onClear,
  onSample,
  onAsk,
  selectedIds = [],
  onToggle,
  hideHeader = false,
}) {
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const submitLink = async () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    if (await onLink(url.trim())) setUrl("");
    setAdding(false);
  };

  const accept = config.allowed_extensions.map((e) => `.${e}`).join(",");

  return (
    <section className="mx-auto w-full max-w-3xl space-y-3 px-3.5 pb-5 pt-4 sm:px-5 xl:px-3.5 xl:pt-2">
      <div className="flex items-center justify-between">
        {!hideHeader ? (
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
            Sources ({docs.length}/{config.max_docs})
          </h2>
        ) : (
          <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
            {docs.length} of {config.max_docs} sources added
          </span>
        )}
        {docs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[11px] font-medium text-[#78716C] transition hover:text-red-600 dark:text-[#A8A29E] dark:hover:text-red-400 cursor-pointer"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Upload Dropzone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`group cursor-pointer rounded-xl border border-dashed px-3.5 py-4 text-center transition-all duration-150 ${
          dragging
            ? "border-[#C85A32] bg-[#C85A32]/8 dark:border-[#D97757] dark:bg-[#D97757]/10"
            : "border-[#D6CFC2] bg-[#FAF8F5]/70 hover:border-[#C85A32]/60 hover:bg-[#FAF8F5] dark:border-[#35322F] dark:bg-[#141312]/50 dark:hover:border-[#D97757]/60 dark:hover:bg-[#22201E]"
        }`}
      >
        <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#EAE4DC] text-[#57534E] transition-colors group-hover:bg-[#C85A32]/15 group-hover:text-[#C85A32] dark:bg-[#262421] dark:text-[#A8A29E] dark:group-hover:bg-[#D97757]/15 dark:group-hover:text-[#D97757]">
          <FiUploadCloud size={17} />
        </div>
        <p className="text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB]">
          Drop files or click to upload
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#78716C] dark:text-[#A8A29E]">
          PDF, Word, Slides, TXT/MD, audio &amp; video · up to {config.max_upload_mb} MB
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Link Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FiLink
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#78716C] dark:text-[#A8A29E]"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitLink()}
            placeholder="YouTube or web link…"
            className="w-full rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] py-2 pl-8 pr-2.5 text-xs text-[#1C1917] outline-none transition placeholder:text-[#A8A29E] focus:border-[#C85A32] focus:ring-2 focus:ring-[#C85A32]/15 dark:border-[#2A2826] dark:bg-[#22201E] dark:text-[#F5F2EB] dark:placeholder:text-[#78716C] dark:focus:border-[#D97757] dark:focus:ring-[#D97757]/15"
          />
        </div>
        <button
          onClick={submitLink}
          disabled={adding || !url.trim()}
          className="min-h-10 rounded-xl bg-[#1C1917] px-3 py-2 text-xs font-medium text-[#FAF8F5] transition hover:bg-[#292524] disabled:cursor-not-allowed disabled:bg-[#E6E1D6] disabled:text-[#A8A29E] dark:bg-[#F5F2EB] dark:text-[#141312] dark:hover:bg-[#E7E5E4] dark:disabled:bg-[#262421] dark:disabled:text-[#57534E] cursor-pointer"
        >
          {adding ? "…" : "Add"}
        </button>
      </div>

      {docs.length === 0 && uploads.length === 0 && (
        <button
          type="button"
          onClick={onSample}
          className="w-full cursor-pointer rounded-xl border border-[#E6E1D6] px-3 py-2 text-xs font-medium text-[#57534E] transition hover:border-[#C85A32]/60 hover:text-[#C85A32] dark:border-[#2A2826] dark:text-[#A8A29E] dark:hover:border-[#D97757]/60 dark:hover:text-[#D97757]"
        >
          Try it with a sample note
        </button>
      )}

      {error && (
        <div
          onClick={clearError}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && clearError()}
          className="flex cursor-pointer items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          <FiAlertCircle className="mt-0.5 shrink-0" size={13} />
          <span className="flex-1 leading-snug">{error}</span>
        </div>
      )}

      {/* Active Uploads & Document List */}
      {(uploads.length > 0 || docs.length > 0) && (
        <ul className="space-y-1.5 pt-0.5">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] px-3 py-2.5 dark:border-[#2A2826] dark:bg-[#22201E]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                  {u.name}
                </p>
                <span className="shrink-0 text-[11px] font-medium text-[#C85A32] dark:text-[#D97757]">
                  {u.progress}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#EAE4DC] dark:bg-[#2C2926]">
                <div
                  className="h-full rounded-full bg-[#C85A32] transition-all duration-200 dark:bg-[#D97757]"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            </li>
          ))}

          {docs.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              selected={selectedIds.includes(d.id)}
              onToggle={onToggle}
              onRemove={onRemove}
              onAsk={onAsk}
            />
          ))}
        </ul>
      )}

      <p className="pt-1 text-[11px] leading-relaxed text-[#78716C]">
        Sources are saved with this notebook. Tick a source to ask or create from just that one.
      </p>
    </section>
  );
}
