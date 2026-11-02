import { FiAlertCircle, FiChevronsRight, FiFolder, FiLoader, FiTrash2, FiX } from "react-icons/fi";

import OutputViewer from "./OutputViewer";
import Panel from "./Panel";
import { ago, TOOL, TOOLS } from "../hooks/Studiotools.js";
import { ICON_BTN } from "../hooks/Ui.js";

function Tile({ tool, disabled, onClick }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group flex min-h-[88px] cursor-pointer flex-col justify-between rounded-2xl p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${tool.tint}`}
    >
      <Icon size={18} />
      <span>
        <span className="block text-[13px] font-medium leading-tight">{tool.label}</span>
        <span className="mt-0.5 block text-[11px] leading-tight opacity-70">{tool.description}</span>
      </span>
    </button>
  );
}

function ItemRow({ output, onOpen, onDelete }) {
  const tool = TOOL[output.kind];
  const Icon = tool?.icon || FiFolder;
  const sourceCount = output.content?.sources?.length || 0;
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
          <span className="block truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">
            {sourceCount > 0 ? `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} · ` : ""}
            {ago(output.created_at)}
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

export default function StudioPanel({ studio, hasReady, scopeCount, onCite, wide, onWide, onCollapse }) {
  const { draft, active, outputs } = studio;
  const lastStep = draft?.steps?.[draft.steps.length - 1]?.label;

  // A finished output, or the one being generated while the reader watches it.
  if (active || (draft && studio.watching)) {
    const shown = active
      ? { title: active.title, kind: active.kind, content: active.content }
      : { title: TOOL[draft.kind]?.label || "Studio", kind: draft.kind, content: { markdown: draft.text, ...(draft.data || {}) } };
    const goBack = () => {
      onWide?.(false);
      studio.close();
    };
    return (
      <OutputViewer
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
      <div className="space-y-5 px-3 pb-5">
        <div>
          <div className="grid grid-cols-2 gap-2">
            {TOOLS.map((tool) => (
              <Tile key={tool.id} tool={tool} disabled={!hasReady || studio.generating} onClick={() => studio.generate(tool.id)} />
            ))}
          </div>
          <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-[#78716C] dark:text-[#A8A29E]">
            {!hasReady
              ? "Add and process a source to unlock these tools."
              : scopeCount > 0
                ? `Creating from ${scopeCount} selected ${scopeCount === 1 ? "source" : "sources"}.`
                : "Creating from all your sources."}
          </p>
        </div>

        <div>
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">Saved outputs</h3>

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
                      {draft.error || lastStep || "Reading your sources"}
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
            {outputs.map((o) => (
              <ItemRow key={o.id} output={o} onOpen={() => studio.open(o.id)} onDelete={() => studio.remove(o.id)} />
            ))}
          </ul>

          {outputs.length === 0 && !draft && (
            <div className="rounded-2xl border border-dashed border-[#D6CFC2] px-4 py-6 text-center dark:border-[#35322F]">
              <FiFolder className="mx-auto mb-2 text-[#A8A29E]" size={18} />
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Studio outputs will be saved here. Pick a tool above to create your first one.</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}