import { useCallback, useRef, useState } from "react";
import { FiAlertTriangle, FiBookOpen, FiLayers, FiMessageCircle, FiRefreshCw, FiWifiOff } from "react-icons/fi";

import useChat from "../hooks/useChat";
import useSources from "../hooks/useSources";
import useStudio from "../hooks/useStudio";
import { renameNotebook } from "../services/api";
import { downloadChat } from "../utils/exportChat";
import ChatInput from "./ChatInput";
import ChatWindow from "./ChatWindow";
import Header from "./Header";
import LibraryPanel from "./LibraryPanel";
import SourceModal from "./SourceModal";
import StudioPanel from "./StudioPanel";

const TABS = [
  { id: "sources", label: "Sources" },
  { id: "chat", label: "Chat" },
  { id: "studio", label: "Studio" },
];

const PANEL = "min-h-0 flex-col overflow-y-auto bg-[#F3EFEA]/50 dark:bg-[#1A1917]/60";

export default function NotebookView({ nid, data, theme, onHome }) {
  const [title, setTitle] = useState(data.notebook.title);
  const [tab, setTab] = useState(data.documents.length ? "chat" : "sources");
  const [cited, setCited] = useState(null); // source shown in the passage dialog

  const sources = useSources(nid, data.documents);

    const [sourcesWidth, setSourcesWidth] = useState(300);
  const [studioWidth, setStudioWidth] = useState(340);

  const resizing = useRef(null);
  const layoutRef = useRef(null);

  const startResize = (panel, event) => {
    event.preventDefault();

    resizing.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "sources" ? sourcesWidth : studioWidth,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event) => {
    if (!resizing.current || !layoutRef.current) return;

    const { panel, startX, startWidth } = resizing.current;
    const delta = event.clientX - startX;
    const containerWidth = layoutRef.current.clientWidth;

    if (panel === "sources") {
      setSourcesWidth(
        Math.max(220, Math.min(startWidth + delta, containerWidth * 0.4))
      );
    } else {
      setStudioWidth(
        Math.max(260, Math.min(startWidth - delta, containerWidth * 0.4))
      );
    }
  };

  const stopResize = () => {
    resizing.current = null;
  };

  const chat = useChat(nid, data.messages);
  const studio = useStudio(nid, data.outputs);

  const scope = sources.selectedIds;
  const readyCount = sources.docs.filter((d) => d.status === "ready").length;
  const closeCite = useCallback(() => setCited(null), []);

  const rename = async (next) => {
    const previous = title;
    setTitle(next);
    try {
      await renameNotebook(nid, next);
    } catch {
      setTitle(previous);
    }
  };

  const ask = (question) => {
    setTab("chat");
    chat.sendMessage(question, scope);
  };

  // Starter questions come free from the source guides (no extra AI call).
  const starters = sources.docs.flatMap((d) => d.guide?.questions || []).slice(0, 4);

  return (
    <div className="flex h-dvh flex-col bg-[#FAF8F5] text-[#1C1917] transition-colors duration-200 dark:bg-[#141312] dark:text-[#F5F2EB]">
      <Header
        theme={theme}
        title={title}
        onTitle={rename}
        onBack={onHome}
        readyCount={readyCount}
        totalDocs={sources.docs.length}
        onExport={chat.messages.length ? () => downloadChat({ title, messages: chat.messages }) : undefined}
      />

      {sources.serverDown && (
        <div className="flex items-center justify-between gap-4 border-b border-red-500/20 bg-red-500/8 px-4 py-2.5 text-xs text-red-900 dark:bg-red-500/10 dark:text-red-200 sm:text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FiWifiOff className="shrink-0" size={15} />
            <span>Can&apos;t reach the server. It may be waking up – try again in a few seconds.</span>
          </span>
          <button
            type="button"
            onClick={sources.retry}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
          >
            <FiRefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      <div
        ref={layoutRef}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        className="notebook-layout grid min-h-0 flex-1"
        style={{
          "--sources-panel-width": `${sourcesWidth}px`,
          "--studio-panel-width": `${studioWidth}px`,
        }}
      >
        <aside
          aria-label="Sources"
          className={`${tab === "sources" ? "flex" : "hidden"} xl:flex ${PANEL} border-r border-[#E6E1D6] dark:border-[#2A2826]`}
        >
          <LibraryPanel
            docs={sources.docs}
            uploads={sources.uploads}
            config={sources.config}
            error={sources.error}
            clearError={sources.clearError}
            onFiles={sources.addFiles}
            onLink={sources.addLink}
            onRemove={sources.remove}
            onClear={sources.clear}
            onSample={sources.addSample}
            onAsk={ask}
            selectedIds={scope}
            onToggle={sources.toggleSelected}
          />
        </aside>

        <div
          role="separator"
          aria-label="Resize Sources panel"
          onPointerDown={(e) => startResize("sources", e)}
          className="panel-resizer group z-10 hidden cursor-col-resize touch-none justify-center xl:flex">
          <div className="h-full w-px bg-[#2A2826] group-hover:w-[3px] group-hover:bg-[#D97757]" />
        </div>


        <main className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col xl:flex`}>
          {chat.messages.length > 0 && (
            <div className="flex justify-end px-4 pt-2 md:px-6">
              <button
                type="button"
                onClick={() => window.confirm("Clear this chat?") && chat.clear()}
                disabled={chat.loading}
                className="cursor-pointer text-[11px] font-medium text-[#78716C] hover:text-red-600 disabled:opacity-50 dark:text-[#A8A29E]"
              >
                Clear chat
              </button>
            </div>
          )}
          <ChatWindow
            messages={chat.messages}
            loading={chat.loading}
            hasReady={sources.hasReady}
            starters={starters}
            onPick={ask}
            onRegenerate={() => chat.regenerate(scope)}
            onCite={setCited}
          />
          <ChatInput
            onSend={(q) => chat.sendMessage(q, scope)}
            onStop={chat.stop}
            loading={chat.loading}
            disabled={!sources.hasReady}
            mode={chat.mode}
            setMode={chat.setMode}
            scopeCount={scope.length}
            onClearScope={sources.clearSelection}
          />
        </main>
        <div
          role="separator"
          aria-label="Resize Studio panel"
          onPointerDown={(e) => startResize("studio", e)}
          className="panel-resizer group z-10 hidden cursor-col-resize touch-none justify-center xl:flex">
          <div className="h-full w-px bg-[#2A2826] group-hover:w-[3px] group-hover:bg-[#D97757]" />
        </div>
        <aside
          aria-label="Studio"
          className={`${tab === "studio" ? "flex" : "hidden"} xl:flex ${PANEL} border-l border-[#E6E1D6] dark:border-[#2A2826]`}
        >
          <StudioPanel
            studio={{ ...studio, generate: (kind) => studio.generate(kind, scope) }}
            hasReady={sources.hasReady}
            scopeCount={scope.length}
            onCite={setCited}
          />
        </aside>
      </div>

      <nav aria-label="Notebook panels" className="mobile-panel-nav flex shrink-0 border-t border-[#E6E1D6] bg-[#FAF8F5] xl:hidden dark:border-[#2A2826] dark:bg-[#141312]">
        {TABS.map((t) => {
          const Icon = t.id === "sources" ? FiBookOpen : t.id === "chat" ? FiMessageCircle : FiLayers;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1 border-t-2 text-xs font-medium transition ${
                active
                  ? "border-[#C85A32] bg-[#C85A32]/5 text-[#C85A32] dark:border-[#D97757] dark:bg-[#D97757]/8 dark:text-[#D97757]"
                  : "border-transparent text-[#78716C] hover:bg-[#F3EFEA] dark:text-[#A8A29E] dark:hover:bg-[#1C1B19]"
              }`}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <SourceModal source={cited} onClose={closeCite} />
    </div>
  );
}

export function NotebookProblem({ kind, onHome, onRetry }) {
  const missing = kind === "missing";
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[#FAF8F5] p-6 text-center dark:bg-[#141312]">
      <FiAlertTriangle size={22} className="text-amber-600" />
      <h1 className="font-serif-editorial text-xl text-[#1C1917] dark:text-[#F5F2EB]">
        {missing ? "Notebook not found" : "Can't reach the server"}
      </h1>
      <p className="max-w-sm text-sm text-[#57534E] dark:text-[#A8A29E]">
        {missing
          ? "It may have been deleted, or it belongs to a different device key."
          : "It may be waking up (free hosting). Try again in a few seconds."}
      </p>
      <div className="flex gap-2">
        {!missing && (
          <button type="button" onClick={onRetry} className="cursor-pointer rounded-xl bg-[#C85A32] px-4 py-2 text-sm font-medium text-white">
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={onHome}
          className="cursor-pointer rounded-xl border border-[#D6CFC2] px-4 py-2 text-sm font-medium text-[#1C1917] dark:border-[#35322F] dark:text-[#F5F2EB]"
        >
          All notebooks
        </button>
      </div>
    </div>
  );
}
