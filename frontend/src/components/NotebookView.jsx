import { useCallback, useState } from "react";
import {
  FiAlertTriangle,
  FiBookOpen,
  FiDownload,
  FiLayers,
  FiMessageCircle,
  FiRefreshCw,
  FiTrash2,
  FiWifiOff,
} from "react-icons/fi";

import useChat from "../hooks/useChat";
import useSources from "../hooks/useSources";
import useStudio from "../hooks/useStudio";
import { renameNotebook } from "../services/api";
import { downloadChat } from "../utils/exportChat";
import ChatInput from "./ChatInput";
import ChatWindow from "./ChatWindow";
import Header from "./Header";
import LibraryPanel from "./LibraryPanel";
import Panel, { Rail } from "./Panel";
import SourceModal from "./SourceModal";
import StudioPanel from "./StudioPanel";
import { ICON_BTN } from "../hooks/Ui";

const TABS = [
  { id: "sources", label: "Sources", icon: FiBookOpen },
  { id: "chat", label: "Chat", icon: FiMessageCircle },
  { id: "studio", label: "Studio", icon: FiLayers },
];

export default function NotebookView({ nid, data, theme, onHome }) {
  const [title, setTitle] = useState(data.notebook.title);
  const [tab, setTab] = useState(data.documents.length ? "chat" : "sources");
  const [cited, setCited] = useState(null); // source shown in the passage dialog

  // Desktop layout: side panels can collapse to a rail, and Studio can widen to read an output.
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const [studioWide, setStudioWide] = useState(false);

  const sources = useSources(nid, data.documents);
  const studio = useStudio(nid, data.outputs);
  // Asking for a quiz, mind map, etc. in chat is made by the Studio model and lands in Studio.
  const chat = useChat(nid, data.messages, { onOutput: studio.addOutput });

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

  const openOutput = (id) => {
    studio.open(id);
    setStudioOpen(true);
    setTab("studio");
  };

  const ask = (question) => {
    setTab("chat");
    chat.sendMessage(question, scope);
  };

  // Starter questions come free from the source guides (no extra AI call).
  const starters = sources.docs.flatMap((d) => d.guide?.questions || []).slice(0, 4);

  const cols = [
    sourcesOpen ? "300px" : "56px",
    "minmax(0, 1fr)",
    studioOpen ? (studioWide ? "minmax(0, 1.5fr)" : "380px") : "56px",
  ].join(" ");

  return (
    <div className="flex h-dvh flex-col bg-[#F3EFEA] text-[#1C1917] transition-colors duration-200 dark:bg-[#0F0E0D] dark:text-[#F5F2EB]">
      <Header theme={theme} title={title} onTitle={rename} onBack={onHome} />

      {sources.serverDown && (
        <div className="mx-3 mb-1 flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-2.5 text-xs text-red-900 sm:text-sm dark:bg-red-500/10 dark:text-red-200">
          <span className="flex min-w-0 items-center gap-2">
            <FiWifiOff className="shrink-0" size={15} />
            <span>Can&apos;t reach the server. It may be waking up – try again in a few seconds.</span>
          </span>
          <button
            type="button"
            onClick={sources.retry}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            <FiRefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      <div className="notebook-layout grid min-h-0 flex-1 gap-3 p-2 pt-0 sm:p-3 sm:pt-0" style={{ "--notebook-cols": cols }}>
        <aside aria-label="Sources" className={`${tab === "sources" ? "block" : "hidden"} min-h-0 xl:block`}>
          {sourcesOpen ? (
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
              onClearSelection={sources.clearSelection}
              onCollapse={() => setSourcesOpen(false)}
            />
          ) : (
            <Rail icon={FiBookOpen} label="Sources" onOpen={() => setSourcesOpen(true)} />
          )}
        </aside>

        <main className={`${tab === "chat" ? "block" : "hidden"} min-h-0 min-w-0 xl:block`}>
          <Panel
            title="Chat"
            scroll={false}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => downloadChat({ title, messages: chat.messages })}
                  disabled={!chat.messages.length}
                  aria-label="Export this chat as Markdown"
                  title="Export chat (Markdown)"
                  className={ICON_BTN}
                >
                  <FiDownload size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm("Clear this chat?") && chat.clear()}
                  disabled={!chat.messages.length || chat.loading}
                  aria-label="Clear chat"
                  title="Clear chat"
                  className={ICON_BTN}
                >
                  <FiTrash2 size={15} />
                </button>
              </>
            }
          >
            <ChatWindow
              messages={chat.messages}
              loading={chat.loading}
              hasReady={sources.hasReady}
              starters={starters}
              onPick={ask}
              onRegenerate={() => chat.regenerate(scope)}
              onCite={setCited}
              outputIds={studio.outputs.map((o) => o.id)}
              onOpenOutput={openOutput}
            />
            <ChatInput
              onSend={(q) => chat.sendMessage(q, scope)}
              onStop={chat.stop}
              loading={chat.loading}
              disabled={!sources.hasReady}
              mode={chat.mode}
              setMode={chat.setMode}
              scopeCount={scope.length}
              readyCount={readyCount}
              onClearScope={sources.clearSelection}
            />
          </Panel>
        </main>

        <aside aria-label="Studio" className={`${tab === "studio" ? "block" : "hidden"} min-h-0 xl:block`}>
          {studioOpen ? (
            <StudioPanel
              studio={{ ...studio, generate: (kind) => studio.generate(kind, scope) }}
              hasReady={sources.hasReady}
              scopeCount={scope.length}
              onCite={setCited}
              wide={studioWide}
              onWide={setStudioWide}
              onCollapse={() => {
                setStudioWide(false);
                setStudioOpen(false);
              }}
            />
          ) : (
            <Rail icon={FiLayers} label="Studio" onOpen={() => setStudioOpen(true)} />
          )}
        </aside>
      </div>

      <nav aria-label="Notebook panels" className="mobile-panel-nav flex shrink-0 gap-1 bg-[#F3EFEA] px-2 pt-1 xl:hidden dark:bg-[#0F0E0D]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium transition ${
                active
                  ? "bg-[#C85A32]/12 text-[#C85A32] dark:bg-[#D97757]/15 dark:text-[#D97757]"
                  : "text-[#78716C] hover:bg-[#EAE4DC]/60 dark:text-[#A8A29E] dark:hover:bg-[#1C1B19]"
              }`}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
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
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[#F3EFEA] p-6 text-center dark:bg-[#0F0E0D]">
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