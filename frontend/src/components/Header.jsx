import { useState } from "react";
import { FiArrowLeft, FiBookOpen, FiMonitor, FiMoon, FiSun } from "react-icons/fi";

const THEME_OPTIONS = [
  { id: "light", label: "Light theme", icon: FiSun },
  { id: "system", label: "System theme", icon: FiMonitor },
  { id: "dark", label: "Dark theme", icon: FiMoon },
];

export default function Header({ theme, title, onTitle, onBack }) {
  const [draft, setDraft] = useState(null); // title being edited

  const commit = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next && next !== title) onTitle?.(next);
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="All notebooks"
            title="All notebooks"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#57534E] transition hover:bg-[#EAE4DC]/70 hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#262421] dark:hover:text-[#F5F2EB]"
          >
            <FiArrowLeft size={18} />
          </button>
        )}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#C85A32] text-white dark:bg-[#D97757] dark:text-[#141312]">
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
            className="min-w-0 max-w-xl flex-1 rounded-lg bg-transparent px-2 py-1.5 font-serif-editorial text-base font-medium tracking-tight text-[#1C1917] outline-none transition hover:bg-[#EAE4DC]/50 focus:bg-[#FFFFFF] focus:ring-2 focus:ring-[#C85A32]/25 sm:text-lg dark:text-[#F5F2EB] dark:hover:bg-[#262421]/60 dark:focus:bg-[#1C1B19]"
          />
        ) : (
          <h1 className="truncate font-serif-editorial text-base font-medium tracking-tight text-[#1C1917] sm:text-lg dark:text-[#F5F2EB]">
            AI Study Assistant
          </h1>
        )}
      </div>

      {theme && (
        <div
          role="group"
          aria-label="Theme preference"
          className="flex shrink-0 items-center rounded-full bg-[#EAE4DC]/60 p-0.5 dark:bg-[#262421]"
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
                className={`flex size-8 cursor-pointer items-center justify-center rounded-full transition-all duration-150 ${
                  active
                    ? "bg-[#FFFFFF] text-[#C85A32] shadow-2xs dark:bg-[#35322F] dark:text-[#D97757]"
                    : "text-[#78716C] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]"
                }`}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}