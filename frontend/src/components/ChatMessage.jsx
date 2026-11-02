import { lazy, Suspense, useState } from "react";
import { FiCheck, FiCopy, FiRefreshCw } from "react-icons/fi";

import { SourceChip } from "./SourceCard";
import { TOOL } from "../hooks/Studiotools";
import StepProgress from "./StepProgress";

const Markdown = lazy(() => import("./Markdown"));

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-[#78716C] transition hover:bg-[#EAE4DC]/70 hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#22201E] dark:hover:text-[#F5F2EB] cursor-pointer";

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
  streaming,
  onRegenerate,
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
    <article className="min-w-0">
      <StepProgress steps={steps} meta={meta} streaming={streaming} />

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

      {sources?.length > 0 && !streaming && (
        <div className="mt-4">
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

      {showActions && (
        <div className="mt-3 -ml-2 flex items-center gap-1">
          {message && <CopyButton text={message} />}
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