import { useEffect, useRef } from "react";
import { FiExternalLink, FiX } from "react-icons/fi";

/** Shows the exact passage behind a citation. */
export default function SourceModal({ source, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!source) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source, onClose]);

  if (!source) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Source: ${source.title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-[#E6E1D6] bg-[#FAF8F5] shadow-xl sm:rounded-2xl dark:border-[#2A2826] dark:bg-[#1C1B19]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E6E1D6] px-5 py-3.5 dark:border-[#2A2826]">
          <div className="min-w-0">
            <p className="truncate font-serif-editorial text-base font-medium text-[#1C1917] dark:text-[#F5F2EB]">
              {source.title}
            </p>
            <p className="mt-0.5 text-xs text-[#78716C] dark:text-[#A8A29E]">
              [{source.id}]{source.locator ? ` · ${source.locator}` : ""}
              {source.external ? " · from the web" : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-[#78716C] hover:bg-[#EAE4DC]/70 dark:text-[#A8A29E] dark:hover:bg-[#262421]"
          >
            <FiX size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-[#292524] dark:text-[#E7E5E4]">
            {source.text || source.snippet}
          </p>
        </div>
        {source.url && (
          <div className="border-t border-[#E6E1D6] px-5 py-3 dark:border-[#2A2826]">
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C85A32] hover:underline dark:text-[#D97757]"
            >
              <FiExternalLink size={12} />
              Open original
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
