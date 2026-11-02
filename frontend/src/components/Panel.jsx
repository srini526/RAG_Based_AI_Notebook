import { CARD } from "../hooks/Ui.js";

/**
 * One rounded card of the notebook workspace: a title bar, then a body.
 * `header` replaces the default title bar (the Studio viewer uses this for its back button).
 */
export default function Panel({ title, actions, header, scroll = true, children, className = "" }) {
  return (
    <div className={`${CARD} flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${className}`}>
      {header ?? (
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <h2 className="min-w-0 truncate font-serif-editorial text-base font-medium tracking-tight text-[#1C1917] dark:text-[#F5F2EB]">
            {title}
          </h2>
          {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
        </div>
      )}
      <div className={`flex min-h-0 flex-1 flex-col ${scroll ? "overflow-y-auto" : ""}`}>{children}</div>
    </div>
  );
}

/** A collapsed side panel: a slim rail with one button to bring the panel back. */
export function Rail({ icon: Icon, label, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${label}`}
      title={`Open ${label}`}
      className={`${CARD} flex h-full w-full cursor-pointer flex-col items-center gap-3 py-4 text-[#78716C] transition hover:bg-[#F3EFEA] hover:text-[#C85A32] dark:text-[#A8A29E] dark:hover:bg-[#22201E] dark:hover:text-[#D97757]`}
    >
      <Icon size={18} />
      <span className="text-[11px] font-medium [text-orientation:mixed] [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}