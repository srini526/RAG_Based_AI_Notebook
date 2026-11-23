import { lazy, Suspense, useState } from "react";
import { FiBookmark, FiCheck, FiCopy, FiRefreshCw } from "react-icons/fi";

import { SourceChip } from "./SourceCard.jsx";
import { TOOL } from "../hooks/Studiotools.js";
import StepProgress from "./StepProgress.jsx";

const Markdown = lazy(() => import("./Markdown.jsx"));

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-[#78716C] transition hover:bg-[#EAE4DC]/70 hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#22201E] dark:hover:text-[#F5F2EB] cursor-pointer";

function SaveAnswer({ onSave }) {
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const save = async () => {
    setState("saving");
    setError("");
    try {
      await onSave();
      setState("saved");
    } catch (err) {
      setError(err?.message || "Couldn't save the answer. Try again.");
      setState("idle");
    }
  };

  return (
    <>
      <button type="button" className={ACTION} onClick={save} disabled={state !== "idle"}>
        {state === "saved" ? <FiCheck size={12} /> : <FiBookmark size={12} />}
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved to Studio" : "Save to Studio"}
      </button>
      {error && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</span>}
    </>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure context / permissions): nothing useful to do
    }
  };
  return (
    <button type="button" onClick={copy} className={ACTION}>
      {copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The Studio item a chat request created, one click away. */
function StudioCard({ studio, onOpen }) {
  const tool = TOOL[studio.kind];
  const Icon = tool?.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${studio.title} in Studio`}
      className="mt-3 flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-2xl border border-[#E6E1D6] bg-[#FFFFFF] p-3 text-left transition hover:border-[#C85A32]/60 hover:shadow-sm dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#D97757]/60"
    >
      {Icon && (
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tool.tint.split(" hover:")[0]}`}>
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">{studio.title}</span>
        <span className="block text-xs text-[#78716C] dark:text-[#A8A29E]">Saved in Studio · tap to open</span>
      </span>
    </button>
  );
}

export default function ChatMessage({
  sender,
  message,
  sources,
  steps,
  meta,
  error,
  stopped,
  retryError,
  streaming,
  onRegenerate,
  onSaveAnswer,
  onCite,
  outputExists,
  onOpenOutput,
}) {
  if (sender === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-[#EAE4DC]/70 px-4 py-2.5 text-[#1C1917] dark:bg-[#262421] dark:text-[#F5F2EB]">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message}</p>
        </div>
      </div>
    );
  }

  const showActions = !streaming && message && !error;

  return (
    <article className="min-w-0" aria-label="Assistant response">
      {streaming && <StepProgress steps={steps} meta={meta} streaming />}

      {message &&
        (error ? (
          <p className="text-[15px] leading-7 text-red-700 dark:text-red-300">{message}</p>
        ) : (
          <Suspense fallback={<p className="whitespace-pre-wrap text-[15px] leading-7">{message}</p>}>
            <Markdown sources={sources} onCite={onCite}>
              {message}
            </Markdown>
          </Suspense>
        ))}

      {meta?.studio && outputExists && !streaming && (
        <StudioCard studio={meta.studio} onOpen={() => onOpenOutput?.(meta.studio.id)} />
      )}

      {stopped && !streaming && <p className="mt-2 text-[11px] text-[#78716C] dark:text-[#A8A29E]">Stopped.</p>}
      {retryError && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{retryError}</p>}

      {sources?.length > 0 && !streaming && (
        <div className="mt-5 border-t border-[#E6E1D6] pt-3 dark:border-[#35322F]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
            Referenced sources ({sources.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source) => (
              <SourceChip key={source.id} source={source} onOpen={onCite} />
            ))}
          </div>
        </div>
      )}

      {!streaming && steps?.length > 0 && (
        <div className="mt-3">
          <StepProgress steps={steps} meta={meta} />
        </div>
      )}

      {!streaming && (showActions || onRegenerate) && (
        <div className="mt-3 -ml-2 flex flex-wrap items-center gap-1">
          {showActions && <CopyButton text={message} />}
          {showActions && onSaveAnswer && !stopped && <SaveAnswer onSave={onSaveAnswer} />}
          {onRegenerate && (
            <button type="button" onClick={onRegenerate} className={ACTION}>
              <FiRefreshCw size={12} />
              Regenerate
            </button>
          )}
        </div>
      )}
    </article>
  );
}