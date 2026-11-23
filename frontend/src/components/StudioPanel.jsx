import { useRef, useState } from "react";
import { FiAlertCircle, FiArrowRight, FiChevronsRight, FiFolder, FiLayers, FiLoader, FiSearch, FiTrash2, FiX } from "react-icons/fi";

import OutputViewer from "./OutputViewer.jsx";
import Panel from "./Panel.jsx";
import { ago, TOOL } from "../hooks/Studiotools.js";
import { ICON_BTN } from "../hooks/Ui.js";

const TOOL_GROUPS = [
  { label: "Review the material", ids: ["briefing", "mindmap", "timeline", "faq"] },
  { label: "Study and practice", ids: ["study_guide", "flashcards", "quiz"] },
];
const FIELD = "h-10 w-full rounded-xl border border-[#E6E1D6] bg-white px-3 text-sm placeholder:text-[#78716C] dark:border-[#35322F] dark:bg-[#141312] dark:placeholder:text-[#A8A29E]";

function Tile({ tool, disabled, onClick }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group flex min-h-21 cursor-pointer flex-col justify-between gap-2 rounded-xl p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${tool.tint}`}
    >
      <span className="flex w-full items-center justify-between">
        <Icon size={17} aria-hidden="true" />
        <FiArrowRight size={13} aria-hidden="true" className="opacity-60 transition group-hover:translate-x-0.5" />
      </span>
      <span>
        <span className="block text-[13px] font-medium leading-tight">{tool.label}</span>
        <span className="mt-0.5 block text-[11px] leading-tight opacity-70">{tool.description}</span>
      </span>
    </button>
  );
}

function outputDetail(content) {
  const counts = [
    [content?.quiz?.questions?.length, "question"],
    [content?.flashcards?.cards?.length, "card"],
    [content?.mindmap?.branches?.length, "branch"],
    [content?.sources?.length, "citation"],
  ];
  const [count, label] = counts.find(([value]) => value > 0) || [];
  return count ? `${count} ${label}${count === 1 ? "" : label === "branch" ? "es" : "s"}` : "";
}

function ItemRow({ output, onOpen, onDelete }) {
  const tool = TOOL[output.kind];
  const Icon = tool?.icon || FiFolder;
  const detail = outputDetail(output.content);
  return (
    <li className="group flex items-center gap-1 rounded-xl transition hover:bg-[#F3EFEA] dark:hover:bg-[#22201E]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${output.title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2 text-left"
      >
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${(tool?.tint || "").split(" hover:")[0]}`}>
          <Icon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-[#1C1917] dark:text-[#F5F2EB]">{output.title}</span>
          {output.content?.focus && (
            <span className="block truncate text-xs text-[#57534E] dark:text-[#D6D3D1]">{output.content.focus}</span>
          )}
          <span className="block truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">
            {[detail, ago(output.created_at)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${output.title}`}
        className={`${ICON_BTN} mr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 hover:!bg-red-500/10 hover:!text-red-600`}
      >
        <FiTrash2 size={14} />
      </button>
    </li>
  );
}

export default function StudioPanel({ studio, readyCount, scopeCount, onCite, wide, onWide, onCollapse }) {
  const [focus, setFocus] = useState("");
  const [search, setSearch] = useState("");
  const saved = useRef(null);
  const { draft, active, outputs } = studio;
  const lastStep = draft?.steps?.[draft.steps.length - 1]?.label;
  const query = search.trim().toLowerCase();
  const visibleOutputs = outputs.filter((output) =>
    `${output.title} ${TOOL[output.kind]?.label || ""} ${output.content?.focus || ""}`.toLowerCase().includes(query),
  );
  const start = (kind) => {
    setSearch("");
    studio.generate(kind, focus);
    saved.current?.scrollIntoView({ block: "start" });
  };

  // A finished output, or the one being generated while the reader watches it.
  if (active || (draft && studio.watching)) {
    const shown = active
      ? { title: active.title, kind: active.kind, content: active.content }
      : { title: TOOL[draft.kind]?.label || "Studio", kind: draft.kind, content: { markdown: draft.text, focus: draft.focus, ...(draft.data || {}) } };
    const goBack = () => {
      onWide?.(false);
      studio.close();
    };
    return (
      <OutputViewer
        key={active?.id || draft?.kind}
        {...shown}
        busy={!active && !draft?.error}
        error={!active ? draft?.error : undefined}
        step={lastStep}
        wide={wide}
        onWide={onWide}
        onBack={goBack}
        onCancel={studio.cancel}
        onDelete={active ? () => studio.remove(active.id) : undefined}
        onCite={onCite}
      />
    );
  }

  return (
    <Panel
      title="Studio"
      actions={
        onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse panel" title="Collapse" className={`${ICON_BTN} hidden xl:inline-flex`}>
            <FiChevronsRight size={17} />
          </button>
        )
      }
    >
      <div className="space-y-5 px-4 pb-5">
        <section aria-label="Create study materials" className="space-y-4">
          <div className="rounded-2xl border border-[#E6E1D6] bg-[#F3EFEA]/55 p-3 dark:border-[#35322F] dark:bg-[#22201E]">
            <p className="mb-2.5 flex items-center gap-2 text-xs text-[#57534E] dark:text-[#D6D3D1]">
              <FiLayers size={14} aria-hidden="true" className="shrink-0 text-[#C85A32] dark:text-[#D97757]" />
              {readyCount === 0 ? "Add a source to create study materials" : scopeCount > 0
                ? `${scopeCount} selected ${scopeCount === 1 ? "source" : "sources"}`
                : `Using all ${readyCount} ready ${readyCount === 1 ? "source" : "sources"}`}
            </p>
            <label htmlFor="studio-focus" className="mb-1.5 block text-xs font-medium">
              Focus topic <span className="font-normal text-[#78716C] dark:text-[#A8A29E]">(optional)</span>
            </label>
            <input id="studio-focus" className={FIELD} maxLength={160} placeholder="e.g. causes of the French Revolution"
              type="text" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </div>
          {TOOL_GROUPS.map(({ label, ids }) => (
            <div key={label}>
              <h3 className="mb-2 text-xs font-semibold text-[#57534E] dark:text-[#D6D3D1]">{label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {ids.map((id) => (
                  <Tile key={id} tool={TOOL[id]} disabled={!readyCount || studio.generating} onClick={() => start(id)} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section ref={saved} aria-labelledby="studio-saved" className="border-t border-[#E6E1D6] pt-4 dark:border-[#35322F]">
          <h3 id="studio-saved" className="mb-2 text-sm font-semibold">Saved outputs</h3>
          {outputs.length > 0 && (
            <label className="relative mb-2 block">
              <span className="sr-only">Search saved outputs</span>
              <FiSearch size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-[#78716C]" />
              <input type="search" className={`${FIELD} pl-8`} placeholder="Search by tool or topic"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          )}

          <ul className="space-y-0.5">
            {draft && (
              <li className="flex items-center gap-1 rounded-xl bg-[#F3EFEA]/70 dark:bg-[#22201E]">
                <button
                  type="button"
                  onClick={() => studio.watch(true)}
                  aria-label={`Open ${TOOL[draft.kind]?.label} being created`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2 text-left"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                      draft.error ? "bg-red-50 text-red-600 dark:bg-red-400/10" : "bg-[#C85A32]/10 text-[#C85A32] dark:bg-[#D97757]/12 dark:text-[#D97757]"
                    }`}
                  >
                    {draft.error ? <FiAlertCircle size={16} /> : <FiLoader size={16} className="animate-spin" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                      {draft.error ? `${TOOL[draft.kind]?.label} failed` : `Creating ${TOOL[draft.kind]?.label.toLowerCase()}…`}
                    </span>
                    <span className="block truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                      {draft.error || [lastStep || "Reading your sources", draft.focus].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={draft.error ? studio.dismiss : studio.cancel}
                  aria-label={draft.error ? "Dismiss" : "Cancel generation"}
                  className={`${ICON_BTN} mr-1`}
                >
                  <FiX size={15} />
                </button>
              </li>
            )}
            {visibleOutputs.map((o) => (
              <ItemRow key={o.id} output={o} onOpen={() => studio.open(o.id)} onDelete={() => studio.remove(o.id)} />
            ))}
          </ul>

          {query && outputs.length > 0 && visibleOutputs.length === 0 && (
            <p role="status" className="px-1 py-3 text-sm text-[#78716C] dark:text-[#A8A29E]">No saved outputs match.</p>
          )}
          {outputs.length === 0 && !draft && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#D6CFC2] px-3 py-4 dark:border-[#35322F]">
              <FiFolder className="shrink-0 text-[#A8A29E]" size={17} aria-hidden="true" />
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Choose a tool above to create your first output.</p>
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}