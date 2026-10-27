import { useState } from "react";
import { FiArrowLeft, FiBookOpen, FiDownload, FiMonitor, FiMoon, FiSun } from "react-icons/fi";

const THEME_OPTIONS = [
  { id: "light", label: "Light theme", icon: FiSun },
  { id: "system", label: "System theme", icon: FiMonitor },
  { id: "dark", label: "Dark theme", icon: FiMoon },
];

export default function Header({ theme, title, onTitle, onBack, onExport, readyCount = 0, totalDocs = 0 }) {
  const [draft, setDraft] = useState(null); // title being edited

  const commit = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next && next !== title) onTitle?.(next);
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#E6E1D6] bg-[#FAF8F5]/90 px-3 backdrop-blur-md transition-colors duration-200 sm:h-15 sm:gap-3 sm:px-4 md:px-6 dark:border-[#2A2826] dark:bg-[#141312]/90">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="All notebooks"
            title="All notebooks"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-[#57534E] transition hover:border-[#E6E1D6] hover:bg-[#F3EFEA] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:border-[#2A2826] dark:hover:bg-[#1C1B19] dark:hover:text-[#F5F2EB]"
          >
            <FiArrowLeft size={18} />
          </button>
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#C85A32]/12 text-[#C85A32] dark:bg-[#D97757]/15 dark:text-[#D97757]">
          <FiBookOpen size={16} />
        </div>
        {onTitle ? (
          <input
            value={draft ?? title}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
            maxLength={120}
            aria-label="Notebook title"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 font-serif-editorial text-sm font-medium tracking-tight text-[#1C1917] outline-none focus:bg-[#F3EFEA] focus:ring-2 focus:ring-[#C85A32]/20 sm:px-1.5 sm:text-lg dark:text-[#F5F2EB] dark:focus:bg-[#1C1B19]"
          />
        ) : (
          <h1 className="truncate font-serif-editorial text-sm font-medium tracking-tight text-[#1C1917] sm:text-lg dark:text-[#F5F2EB]">
            AI Study Assistant
          </h1>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {totalDocs > 0 && (
          <div className="hidden items-center gap-1.5 rounded-full border border-[#E6E1D6] bg-[#F3EFEA]/80 px-2.5 py-1 text-xs font-medium text-[#57534E] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#A8A29E] sm:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                readyCount > 0 ? "bg-emerald-600 dark:bg-emerald-400" : "bg-amber-500 animate-pulse"
              }`}
            />
            <span>
              {readyCount} {readyCount === 1 ? "source" : "sources"} ready
            </span>
          </div>
        )}

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            aria-label="Export this chat as Markdown"
            title="Export chat (Markdown)"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[#E6E1D6] bg-[#F3EFEA] text-[#57534E] transition hover:text-[#C85A32] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#A8A29E] dark:hover:text-[#D97757]"
          >
            <FiDownload size={14} />
          </button>
        )}

        {theme && (
          <div
            role="group"
            aria-label="Theme preference"
            className="flex items-center rounded-lg border border-[#E6E1D6] bg-[#F3EFEA] p-0.5 dark:border-[#2A2826] dark:bg-[#1C1B19]"
          >
            {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
              const active = theme.preference === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => theme.setPreference(id)}
                  aria-label={label}
                  title={label}
                  className={`flex h-8 w-8 items-center justify-center rounded-md text-xs transition-all duration-150 cursor-pointer ${
                    active
                      ? "bg-[#FFFFFF] text-[#C85A32] shadow-2xs dark:bg-[#282623] dark:text-[#D97757]"
                      : "text-[#78716C] hover:text-[#1C1917] dark:text-[#78716C] dark:hover:text-[#F5F2EB]"
                  }`}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
}
