import { useState } from "react";
import {
  FiAlertCircle,
  FiChevronsLeft,
  FiFileText,
  FiFilm,
  FiGlobe,
  FiLoader,
  FiMonitor,
  FiMusic,
  FiPlus,
  FiTrash2,
  FiYoutube,
} from "react-icons/fi";

import AddSourcesDialog from "./AddSourcesdialog";
import Panel from "./Panel";
import { ICON_BTN, PILL_BTN } from "../hooks/Ui.js";

const KIND = {
  pdf: { icon: FiFileText, tint: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300" },
  docx: { icon: FiFileText, tint: "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300" },
  text: { icon: FiFileText, tint: "bg-stone-100 text-stone-600 dark:bg-stone-400/10 dark:text-stone-300" },
  pptx: { icon: FiMonitor, tint: "bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300" },
  audio: { icon: FiMusic, tint: "bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300" },
  video: { icon: FiFilm, tint: "bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300" },
  youtube: { icon: FiYoutube, tint: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300" },
  web: { icon: FiGlobe, tint: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" },
};

function DocRow({ doc, selected, onToggle, onRemove, onAsk }) {
  const [showGuide, setShowGuide] = useState(false);
  const { icon: Icon, tint } = KIND[doc.kind] || KIND.text;
  const working = doc.status === "queued" || doc.status === "processing";

  return (
    <li className="group rounded-xl px-2 py-2 transition hover:bg-[#F3EFEA] dark:hover:bg-[#22201E]">
      <div className="flex items-center gap-3">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tint}`}>
          <Icon size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[#1C1917] dark:text-[#F5F2EB]" title={doc.name}>
            {doc.name}
          </p>
          {working && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#C85A32] dark:text-[#D97757]">
              <FiLoader className="shrink-0 animate-spin" size={11} />
              <span className="truncate">{doc.message || "Queued…"}</span>
            </p>
          )}
          {doc.status === "error" && (
            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-red-600 dark:text-red-400">
              <FiAlertCircle className="mt-0.5 shrink-0" size={11} />
              <span>{doc.message}</span>
            </p>
          )}
          {doc.status === "ready" && (
            <p className="mt-0.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]">{doc.chunks} passages</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onRemove(doc.id)}
          aria-label={`Remove ${doc.name}`}
          className="shrink-0 cursor-pointer rounded-full p-1.5 text-[#A8A29E] opacity-100 transition hover:bg-red-500/10 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:text-[#78716C] dark:hover:text-red-400"
        >
          <FiTrash2 size={13} />
        </button>

        {doc.status === "ready" && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(doc.id)}
            aria-label={`Ask only about ${doc.name}`}
            title="Ask only about this source"
            className="size-4 shrink-0 cursor-pointer accent-[#C85A32]"
          />
        )}
      </div>

      {doc.guide && (
        <div className="ml-11 mt-1">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            aria-expanded={showGuide}
            className="cursor-pointer text-[11px] font-medium text-[#C85A32] hover:underline dark:text-[#D97757]"
          >
            {showGuide ? "Hide source guide" : "Source guide"}
          </button>
          {showGuide && (
            <div className="fade-up mt-2 space-y-2.5 text-[12px] leading-relaxed text-[#57534E] dark:text-[#A8A29E]">
              <p>{doc.guide.summary}</p>
              {doc.guide.topics?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {doc.guide.topics.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[#EAE4DC]/70 px-2 py-0.5 text-[10px] text-[#57534E] dark:bg-[#2C2926] dark:text-[#A8A29E]"
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
                  className="block w-full cursor-pointer rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] px-3 py-2 text-left text-[12px] text-[#292524] transition hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#E7E5E4]"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  onClearSelection,
  onCollapse,
}) {
  const [adding, setAdding] = useState(false);
  const empty = docs.length === 0 && uploads.length === 0;
  const atLimit = docs.length >= config.max_docs;

  return (
    <Panel
      title={
        <>
          Sources <span className="text-sm font-normal text-[#78716C] dark:text-[#A8A29E]">({docs.length}/{config.max_docs})</span>
        </>
      }
      actions={
        onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse sources" title="Collapse" className={`${ICON_BTN} hidden xl:inline-flex`}>
            <FiChevronsLeft size={17} />
          </button>
        )
      }
    >
      <div className="space-y-3 px-3 pb-4">
        <button type="button" onClick={() => setAdding(true)} disabled={atLimit} className={`${PILL_BTN} w-full`}>
          <FiPlus size={16} />
          {atLimit ? "Source limit reached" : "Add sources"}
        </button>

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

        {empty ? (
          <div className="px-3 py-10 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#F3EFEA] text-[#A8A29E] dark:bg-[#262421]">
              <FiFileText size={20} />
            </span>
            <p className="mt-3 text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">Saved sources will appear here</p>
            <p className="mt-1 text-xs leading-relaxed text-[#78716C] dark:text-[#A8A29E]">
              Add PDFs, websites, YouTube videos, notes, audio or slides to get started.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-2 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
              <span>{selectedIds.length > 0 ? `${selectedIds.length} selected` : "All sources in use"}</span>
              {selectedIds.length > 0 && (
                <button type="button" onClick={onClearSelection} className="cursor-pointer font-medium text-[#C85A32] hover:underline dark:text-[#D97757]">
                  Use all
                </button>
              )}
            </div>

            <ul className="space-y-0.5">
              {uploads.map((u) => (
                <li key={u.id} className="rounded-xl px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-[#1C1917] dark:text-[#F5F2EB]">{u.name}</p>
                    <span className="shrink-0 text-[11px] font-medium text-[#C85A32] dark:text-[#D97757]">{u.progress}%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#EAE4DC] dark:bg-[#2C2926]">
                    <div className="h-full rounded-full bg-[#C85A32] transition-all duration-200 dark:bg-[#D97757]" style={{ width: `${u.progress}%` }} />
                  </div>
                </li>
              ))}
              {docs.map((d) => (
                <DocRow key={d.id} doc={d} selected={selectedIds.includes(d.id)} onToggle={onToggle} onRemove={onRemove} onAsk={onAsk} />
              ))}
            </ul>

            {docs.length > 0 && (
              <div className="flex justify-end px-2">
                <button
                  type="button"
                  onClick={onClear}
                  className="cursor-pointer text-[11px] font-medium text-[#78716C] transition hover:text-red-600 dark:text-[#A8A29E] dark:hover:text-red-400"
                >
                  Remove all
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {adding && (
        <AddSourcesDialog
          config={config}
          showSample={empty}
          onFiles={onFiles}
          onLink={onLink}
          onSample={onSample}
          onClose={() => setAdding(false)}
        />
      )}
    </Panel>
  );
}