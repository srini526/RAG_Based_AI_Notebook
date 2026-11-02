import { useEffect, useRef, useState } from "react";
import { FiArrowUp, FiCheck, FiChevronDown, FiSquare } from "react-icons/fi";

const MODES = [
  { id: "normal", label: "Standard answers" },
  { id: "simple", label: "Explain simply" },
  { id: "exam", label: "Exam notes" },
  { id: "deep", label: "Deep dive" },
];

export default function ChatInput({
  onSend,
  onStop,
  loading,
  disabled,
  mode,
  setMode,
  scopeCount = 0,
  readyCount = 0,
  onClearScope,
}) {
  const [question, setQuestion] = useState("");
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef(null);

  useEffect(() => {
    const outside = (e) => modeRef.current && !modeRef.current.contains(e.target) && setModeOpen(false);
    const escape = (e) => e.key === "Escape" && setModeOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const blocked = loading || disabled;
  const submit = () => {
    if (!question.trim() || blocked) return;
    onSend(question);
    setQuestion("");
  };

  const used = scopeCount || readyCount;

  return (
    <div className="chat-input-shell shrink-0 px-3 pt-1 sm:px-5">
      <div className="mx-auto max-w-3xl">
        <div
          className={`rounded-3xl border bg-[#FAF8F5] shadow-2xs transition dark:bg-[#141312] ${
            disabled
              ? "border-[#E6E1D6] opacity-75 dark:border-[#2A2826]"
              : "border-[#D6CFC2] focus-within:border-[#C85A32] focus-within:ring-3 focus-within:ring-[#C85A32]/12 dark:border-[#322F2B] dark:focus-within:border-[#D97757] dark:focus-within:ring-[#D97757]/15"
          }`}
        >
          <input
            type="text"
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
            placeholder={disabled ? "Add a source to start asking…" : "Start typing…"}
            aria-label="Your question"
            disabled={blocked}
            className="w-full bg-transparent px-5 pb-1 pt-4 text-sm text-[#1C1917] outline-none placeholder:text-[#A8A29E] disabled:cursor-not-allowed dark:text-[#F5F2EB] dark:placeholder:text-[#78716C]"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <div className="relative" ref={modeRef}>
              <button
                type="button"
                aria-label="Choose answer style"
                aria-expanded={modeOpen}
                onClick={() => setModeOpen((o) => !o)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-[#57534E] transition hover:bg-[#EAE4DC]/70 dark:text-[#A8A29E] dark:hover:bg-[#262421]"
              >
                {MODES.find((m) => m.id === mode)?.label ?? "Standard answers"}
                <FiChevronDown size={13} className={`transition-transform ${modeOpen ? "rotate-180" : ""}`} />
              </button>

              {modeOpen && (
                <div className="fade-up absolute bottom-full left-0 z-50 mb-2 w-52 rounded-2xl border border-[#E6E1D6] bg-[#FFFFFF] p-1.5 shadow-lg dark:border-[#2A2826] dark:bg-[#1C1B19]">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setMode(m.id);
                        setModeOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                        mode === m.id
                          ? "bg-[#C85A32]/10 text-[#C85A32] dark:bg-[#D97757]/12 dark:text-[#D97757]"
                          : "text-[#292524] hover:bg-[#F3EFEA] dark:text-[#E7E5E4] dark:hover:bg-[#262421]"
                      }`}
                    >
                      <span>{m.label}</span>
                      {mode === m.id && <FiCheck size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {used > 0 && (
                <button
                  type="button"
                  onClick={scopeCount ? onClearScope : undefined}
                  title={scopeCount ? "Search all sources again" : undefined}
                  className={`rounded-full px-2.5 py-1 text-xs text-[#57534E] dark:text-[#A8A29E] ${
                    scopeCount ? "cursor-pointer bg-[#C85A32]/10 hover:bg-[#C85A32]/15" : "cursor-default"
                  }`}
                >
                  {scopeCount ? `${used} selected ✕` : `${used} ${used === 1 ? "source" : "sources"}`}
                </button>
              )}

              {loading ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop generating"
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#1C1917] text-[#FAF8F5] transition hover:bg-[#292524] dark:bg-[#F5F2EB] dark:text-[#141312]"
                >
                  <FiSquare size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={blocked || !question.trim()}
                  aria-label="Send"
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#C85A32] text-white transition hover:bg-[#B24C28] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#E6E1D6] disabled:text-[#A8A29E] dark:disabled:bg-[#2A2826] dark:disabled:text-[#57534E]"
                >
                  <FiArrowUp size={17} className="stroke-[2.2]" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="py-2 text-center text-[10px] text-[#A8A29E]">Answers are grounded in your sources. Check important details.</p>
      </div>
    </div>
  );
}