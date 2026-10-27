import { useState } from "react";
import { FiCheck, FiChevronDown, FiGlobe, FiLoader, FiRefreshCw } from "react-icons/fi";

/**
 * Shows what the agent is doing (Searching… Grading… Rewriting…).
 * While streaming: a live checklist. Afterwards: a collapsed summary line.
 */
export default function StepProgress({ steps = [], meta, streaming }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const rewrites = meta?.rewrites || 0;

  if (streaming) {
    return (
      <div className="mb-4 rounded-xl border border-[#E6E1D6] bg-[#F3EFEA]/70 px-3.5 py-2.5 dark:border-[#2A2826] dark:bg-[#1C1B19]/80">
        <ul className="space-y-1.5 text-xs">
          {steps.map((step, i) => {
            const active = i === steps.length - 1;
            return (
              <li
                key={i}
                className={`flex items-center gap-2 transition-colors ${
                  active
                    ? "font-medium text-[#C85A32] dark:text-[#D97757]"
                    : "text-[#78716C] dark:text-[#A8A29E]"
                }`}
              >
                {active ? (
                  <FiLoader className="animate-spin shrink-0" size={13} />
                ) : (
                  <FiCheck className="shrink-0 text-emerald-600 dark:text-emerald-400" size={13} />
                )}
                <span>{step.label}…</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-[#E6E1D6] bg-[#F3EFEA]/70 px-2.5 py-1 text-xs text-[#57534E] transition hover:border-[#D6CFC2] hover:text-[#1C1917] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#A8A29E] dark:hover:border-[#3A3734] dark:hover:text-[#F5F2EB] cursor-pointer"
      >
        <FiChevronDown
          size={13}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
        <span>
          How this answer was found · {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>

        {rewrites > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
            <FiRefreshCw size={10} /> rephrased {rewrites}×
          </span>
        )}

        {meta?.web && (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/12 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:text-sky-300">
            <FiGlobe size={10} /> web search
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-2 ml-2 space-y-1.5 border-l-2 border-[#E6E1D6] pl-3.5 text-xs text-[#57534E] dark:border-[#2A2826] dark:text-[#A8A29E]">
          {steps.map((step, i) => (
            <li key={i} className="flex items-center gap-2">
              <FiCheck size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{step.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
