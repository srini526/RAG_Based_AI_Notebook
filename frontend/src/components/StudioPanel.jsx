import {
  FiBookOpen,
  FiCheckSquare,
  FiClock,
  FiFileText,
  FiHelpCircle,
  FiLayers,
  FiShare2,
  FiTrash2,
} from "react-icons/fi";

import OutputViewer from "./OutputViewer";

const TOOLS = [
  { id: "briefing", label: "Briefing doc", icon: FiFileText },
  { id: "study_guide", label: "Study guide", icon: FiBookOpen },
  { id: "faq", label: "FAQ", icon: FiHelpCircle },
  { id: "timeline", label: "Timeline", icon: FiClock },
  { id: "mindmap", label: "Mind map", icon: FiShare2 },
  { id: "flashcards", label: "Flashcards", icon: FiLayers },
  { id: "quiz", label: "Quiz", icon: FiCheckSquare },
];
const LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));
const ICON = Object.fromEntries(TOOLS.map((t) => [t.id, t.icon]));

const ago = (ts) => {
  const minutes = Math.round((Date.now() / 1000 - ts) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};

export default function StudioPanel({ studio, hasReady, scopeCount, onCite }) {
  const { draft, active, outputs } = studio;

  if (draft) {
    const content = { markdown: draft.text, ...(draft.data || {}) };
    return (
      <OutputViewer
        title={LABEL[draft.kind]}
        kind={draft.kind}
        content={content}
        busy={!draft.error}
        error={draft.error}
        onBack={studio.back}
        onCancel={studio.cancel}
        onCite={onCite}
      />
    );
  }
  if (active) {
    return (
      <OutputViewer
        title={active.title}
        kind={active.kind}
        content={active.content}
        onBack={studio.back}
        onDelete={() => studio.remove(active.id)}
        onCite={onCite}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-5 xl:p-3.5">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
          Studio
        </h2>
        <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
          {hasReady
            ? scopeCount > 0
              ? `Create from the ${scopeCount} selected ${scopeCount === 1 ? "source" : "sources"}.`
              : "Create from all your sources."
            : "Add a source to unlock these tools."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            disabled={!hasReady}
            onClick={() => studio.generate(id)}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] px-3 py-2.5 text-left text-xs font-medium text-[#292524] shadow-2xs transition enabled:hover:border-[#C85A32]/60 enabled:hover:text-[#C85A32] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2A2826] dark:bg-[#22201E] dark:text-[#E7E5E4] dark:enabled:hover:border-[#D97757]/60 dark:enabled:hover:text-[#D97757]"
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {outputs.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
            Saved outputs
          </h3>
          <ul className="space-y-1.5">
            {outputs.map((o) => {
              const Icon = ICON[o.kind] || FiFileText;
              return (
                <li
                  key={o.id}
                  className="group flex items-center gap-2 rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] pr-1.5 dark:border-[#2A2826] dark:bg-[#22201E]"
                >
                  <button
                    type="button"
                    onClick={() => studio.open(o.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <Icon size={13} className="shrink-0 text-[#78716C] dark:text-[#A8A29E]" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                        {o.title}
                      </span>
                      <span className="block text-[11px] text-[#78716C] dark:text-[#A8A29E]">{ago(o.created_at)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => studio.remove(o.id)}
                    aria-label={`Delete ${o.title}`}
                    className="cursor-pointer rounded-lg p-1.5 text-[#A8A29E] opacity-80 transition hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                  >
                    <FiTrash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
