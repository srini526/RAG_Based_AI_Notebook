import { lazy, Suspense, useState } from "react";
import { FiBookOpen, FiCheck, FiCopy, FiRefreshCw } from "react-icons/fi";

import SourceCard from "./SourceCard";
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
}) {
  if (sender === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-2xl rounded-br-sm border border-[#E2DAD0] bg-[#EFECE6] px-4 py-3 text-[#1C1917] shadow-2xs transition-colors duration-200 dark:border-[#322F2B] dark:bg-[#24221F] dark:text-[#F5F2EB]">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message}</p>
        </div>
      </div>
    );
  }

  const showActions = !streaming && message && !error;

  return (
    <article className="flex gap-3.5 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6E1D6] bg-[#F3EFEA] text-[#C85A32] shadow-2xs dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#D97757]">
        <FiBookOpen size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-serif-editorial text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
            Study Assistant
          </span>
        </div>

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

        {stopped && !streaming && (
          <p className="mt-2 text-[11px] text-[#78716C] dark:text-[#A8A29E]">Stopped.</p>
        )}

        {sources?.length > 0 && (
          <div className="mt-6 border-t border-[#E6E1D6] pt-4 dark:border-[#2A2826]">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
              <span>Referenced Sources ({sources.length})</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {sources.map((source) => (
                <SourceCard key={source.id} source={source} onOpen={onCite} />
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
      </div>
    </article>
  );
}
