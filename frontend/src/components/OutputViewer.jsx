import { lazy, Suspense, useState } from "react";
import {
  FiArrowLeft,
  FiCheck,
  FiChevronDown,
  FiCopy,
  FiDownload,
  FiLoader,
  FiMaximize2,
  FiMinimize2,
  FiTrash2,
  FiX,
} from "react-icons/fi";

import Flashcards from "./Flashcards";
import MindMap from "./MindMap";
import Panel from "./Panel";
import Quiz from "./Quiz";
import { SourceChip } from "./SourceCard";
import { TOOL } from "../hooks/Studiotools.js";
import { ICON_BTN } from "../hooks/Ui.js";

const Markdown = lazy(() => import("./Markdown"));

function LoadingState({ title, step }) {
  return (
    <div className="space-y-5 py-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#C85A32]/10 text-[#C85A32] dark:bg-[#D97757]/10 dark:text-[#D97757]">
          <FiLoader size={18} className="animate-spin" />
        </span>
        <div>
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">Creating your {title.toLowerCase()}…</p>
          <p className="mt-0.5 text-xs text-[#78716C] dark:text-[#A8A29E]">{step || "Reading your sources"}</p>
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse space-y-2">
          <div className="h-3 w-2/5 rounded-full bg-[#EAE4DC] dark:bg-[#2C2926]" />
          <div className="h-2.5 w-full rounded-full bg-[#F0ECE6] dark:bg-[#262421]" />
          <div className="h-2.5 w-4/5 rounded-full bg-[#F0ECE6] dark:bg-[#262421]" />
        </div>
      ))}
    </div>
  );
}

export default function OutputViewer({
  title,
  kind,
  content = {},
  busy = false,
  error,
  step,
  wide = false,
  onWide,
  onBack,
  onDelete,
  onCancel,
  onCite,
}) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const markdown = content?.markdown || "";
  const sources = content?.sources || [];
  const structured = Boolean(content?.quiz || content?.flashcards || content?.mindmap);
  const hasContent = Boolean(markdown || structured);
  const tool = TOOL[kind];
  const Icon = tool?.icon;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "studio-output").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const header = (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-2.5">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Studio"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-[#57534E] transition hover:bg-[#F3EFEA] hover:text-[#C85A32] dark:text-[#A8A29E] dark:hover:bg-[#262421] dark:hover:text-[#D97757]"
      >
        <FiArrowLeft size={15} />
        Studio
      </button>

      <div className="flex items-center gap-0.5">
        {markdown && !busy && (
          <>
            <button type="button" onClick={copy} aria-label="Copy as text" title="Copy" className={ICON_BTN}>
              {copied ? <FiCheck size={15} /> : <FiCopy size={15} />}
            </button>
            <button type="button" onClick={download} aria-label="Export as Markdown" title="Export (Markdown)" className={ICON_BTN}>
              <FiDownload size={15} />
            </button>
          </>
        )}
        {onWide && (
          <button
            type="button"
            onClick={() => onWide(!wide)}
            aria-label={wide ? "Shrink panel" : "Expand panel"}
            title={wide ? "Shrink" : "Expand"}
            className={`${ICON_BTN} hidden xl:inline-flex`}
          >
            {wide ? <FiMinimize2 size={15} /> : <FiMaximize2 size={15} />}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} aria-label="Delete output" title="Delete" className={`${ICON_BTN} hover:!bg-red-500/10 hover:!text-red-600`}>
            <FiTrash2 size={15} />
          </button>
        )}
        {busy && onCancel && (
          <button type="button" onClick={onCancel} aria-label="Cancel generation" title="Cancel" className={ICON_BTN}>
            <FiX size={16} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Panel header={header}>
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-1 sm:px-6">
        <div className="mb-5 flex items-center gap-3">
          {Icon && (
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tool.tint.split(" hover:")[0]}`}>
              <Icon size={18} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate font-serif-editorial text-xl font-medium tracking-tight text-[#1C1917] dark:text-[#F5F2EB]">{title}</h3>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
              {busy ? "Generating…" : tool?.label}
              {sources.length > 0 && ` · ${sources.length} ${sources.length === 1 ? "source" : "sources"}`}
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-red-300/60 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
            <p className="font-semibold">Generation failed</p>
            <p className="mt-1 text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {busy && !hasContent && <LoadingState title={title} step={step} />}

        {markdown && (
          <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-[#F0ECE6] dark:bg-[#262421]" />}>
            <Markdown sources={sources} onCite={onCite}>
              {markdown}
            </Markdown>
          </Suspense>
        )}

        {content?.quiz && <Quiz quiz={content.quiz} />}
        {content?.flashcards && <Flashcards cards={content.flashcards} />}
        {content?.mindmap && <MindMap map={content.mindmap} tall={wide} />}

        {sources.length > 0 && !busy && (
          <section className="mt-8 border-t border-[#E6E1D6] pt-4 dark:border-[#2A2826]">
            <button
              type="button"
              onClick={() => setSourcesOpen((v) => !v)}
              aria-expanded={sourcesOpen}
              className="flex w-full cursor-pointer items-center justify-between text-left"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
                Referenced sources ({sources.length})
              </span>
              <FiChevronDown size={15} className={`text-[#A8A29E] transition-transform ${sourcesOpen ? "rotate-180" : ""}`} />
            </button>
            {sourcesOpen && (
              <div className="fade-up mt-3 flex flex-wrap gap-1.5">
                {sources.map((source) => (
                  <SourceChip key={source.id} source={source} onOpen={onCite} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}