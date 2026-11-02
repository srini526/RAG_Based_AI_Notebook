import { useEffect, useMemo, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiRotateCw, FiShuffle } from "react-icons/fi";

import { ICON_BTN } from "../hooks/Ui.js";

/** A big flip card with progress, keyboard shortcuts (← → space) and shuffle. */
export default function Flashcards({ cards }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const root = useRef(null);

  const card = cards[order[index]];
  const count = cards.length;

  const go = (step) => {
    setFlipped(false);
    setIndex((i) => (i + step + count) % count);
  };

  const shuffle = () => {
    const next = cards.map((_, i) => i);
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setIndex(0);
    setFlipped(false);
  };

  const keys = useMemo(
    () => (e) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " && e.target === root.current) {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count],
  );

  useEffect(() => {
    const el = root.current;
    el?.addEventListener("keydown", keys);
    return () => el?.removeEventListener("keydown", keys);
  }, [keys]);

  return (
    <div ref={root} tabIndex={-1} className="mx-auto max-w-xl space-y-4 outline-none">
      <div className="h-1.5 overflow-hidden rounded-full bg-[#EAE4DC] dark:bg-[#2C2926]">
        <div
          className="h-full rounded-full bg-[#C85A32] transition-all duration-300 dark:bg-[#D97757]"
          style={{ width: `${((index + 1) / count) * 100}%` }}
        />
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show the question" : "Show the answer"}
        className={`fade-up flex min-h-72 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border p-8 text-center shadow-xs transition hover:shadow-md ${
          flipped
            ? "border-[#C85A32]/40 bg-[#C85A32]/6 dark:border-[#D97757]/40 dark:bg-[#D97757]/8"
            : "border-[#E6E1D6] bg-[#FFFFFF] hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:bg-[#1C1B19]"
        }`}
        key={`${index}-${flipped}`}
      >
        <span className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C85A32] dark:text-[#D97757]">
          {flipped ? "Answer" : "Question"}
        </span>
        <span
          className={`whitespace-pre-wrap text-[#1C1917] dark:text-[#F5F2EB] ${
            flipped ? "text-base leading-relaxed" : "font-serif-editorial text-2xl leading-snug"
          }`}
        >
          {flipped ? card.back : card.front}
        </span>
        <span className="mt-6 inline-flex items-center gap-1.5 text-[11px] text-[#A8A29E]">
          <FiRotateCw size={12} /> Click to flip
        </span>
      </button>

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} aria-label="Previous card" className={`${ICON_BTN} border border-[#E6E1D6] dark:border-[#2A2826]`}>
          <FiChevronLeft size={17} />
        </button>
        <div className="flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span>
            {index + 1} / {count}
          </span>
          <button type="button" onClick={shuffle} aria-label="Shuffle cards" title="Shuffle" className={ICON_BTN}>
            <FiShuffle size={14} />
          </button>
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Next card" className={`${ICON_BTN} border border-[#E6E1D6] dark:border-[#2A2826]`}>
          <FiChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}