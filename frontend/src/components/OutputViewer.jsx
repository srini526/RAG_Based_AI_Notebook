import { lazy, Suspense, useState } from "react";
import { FiArrowLeft, FiCheck, FiCopy, FiLoader, FiTrash2 } from "react-icons/fi";

import Flashcards from "./Flashcards";
import MindMap from "./MindMap";
import Quiz from "./Quiz";
import SourceCard from "./SourceCard";

const Markdown = lazy(() => import("./Markdown"));

const BTN =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-[#78716C] transition hover:bg-[#EAE4DC]/70 hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#22201E] dark:hover:text-[#F5F2EB]";

/** One Studio output: a saved one, or a draft that is still being generated. */
export default function OutputViewer({ title, kind, content, busy, error, onBack, onDelete, onCancel, onCite }) {
  const [copied, setCopied] = useState(false);
  const markdown = content.markdown || "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };

  return (
    <div className="space-y-3 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className={BTN}>
          <FiArrowLeft size={12} />
          Studio
        </button>
        <div className="flex items-center gap-1">
          {markdown && !busy && (
            <button type="button" onClick={copy} className={BTN}>
              {copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className={`${BTN} hover:text-red-600`}>
              <FiTrash2 size={12} />
              Delete
            </button>
          )}
          {busy && (
            <button type="button" onClick={onCancel} className={BTN}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <h3 className="font-serif-editorial text-base font-medium text-[#1C1917] dark:text-[#F5F2EB]">{title}</h3>

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}

      {busy && !markdown && !content.mindmap && !content.flashcards && !content.quiz && (
        <p className="flex items-center gap-2 text-xs text-[#C85A32] dark:text-[#D97757]">
          <FiLoader className="animate-spin" size={12} />
          Working on it…
        </p>
      )}

      {markdown && (
        <Suspense fallback={<p className="whitespace-pre-wrap text-sm">{markdown}</p>}>
          <Markdown sources={content.sources || []} onCite={onCite}>
            {markdown}
          </Markdown>
        </Suspense>
      )}
      {content.quiz && <Quiz quiz={content.quiz} />}
      {content.flashcards && <Flashcards key={kind} cards={content.flashcards} />}
      {content.mindmap && <MindMap map={content.mindmap} />}

      {content.sources?.length > 0 && !busy && (
        <div className="space-y-2 border-t border-[#E6E1D6] pt-3 dark:border-[#2A2826]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
            Sources ({content.sources.length})
          </p>
          {content.sources.map((s) => (
            <SourceCard key={s.id} source={s} onOpen={onCite} />
          ))}
        </div>
      )}
    </div>
  );
}
