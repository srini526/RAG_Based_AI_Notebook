import { useState } from "react";
import { FiArrowLeft, FiArrowRight, FiCheckCircle, FiRotateCcw, FiXCircle } from "react-icons/fi";

import { PILL_BTN, PRIMARY_BTN } from "../hooks/Ui.js";

const LETTERS = "ABCDEFGH";

/** One question at a time, with progress, instant feedback and a result screen. */
export default function Quiz({ quiz }) {
  const questions = quiz.questions;
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState({}); // question index -> chosen option index
  const [finished, setFinished] = useState(false);

  const answered = Object.keys(picked).length;
  const score = questions.filter((q, i) => picked[i] === q.answer_index).length;

  const restart = () => {
    setPicked({});
    setIndex(0);
    setFinished(false);
  };

  if (finished) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="fade-up mx-auto max-w-md py-8 text-center">
        <div className="mx-auto flex size-28 items-center justify-center rounded-full border-8 border-[#C85A32]/20 dark:border-[#D97757]/25">
          <span className="font-serif-editorial text-3xl font-medium text-[#C85A32] dark:text-[#D97757]">{pct}%</span>
        </div>
        <h3 className="mt-5 font-serif-editorial text-xl font-medium text-[#1C1917] dark:text-[#F5F2EB]">Quiz complete</h3>
        <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
          You answered {score} of {total} correctly.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button type="button" onClick={restart} className={PRIMARY_BTN}>
            <FiRotateCcw size={14} /> Try again
          </button>
          <button type="button" onClick={() => setFinished(false)} className={PILL_BTN}>
            Review answers
          </button>
        </div>
      </div>
    );
  }

  const q = questions[index];
  const choice = picked[index];
  const done = choice !== undefined;
  const last = index === total - 1;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span>
            Question {index + 1} of {total}
          </span>
          {answered > 0 && (
            <span className="font-medium text-[#1C1917] dark:text-[#F5F2EB]">
              Score: {score} / {answered}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#EAE4DC] dark:bg-[#2C2926]">
          <div
            className="h-full rounded-full bg-[#C85A32] transition-all duration-300 dark:bg-[#D97757]"
            style={{ width: `${((index + (done ? 1 : 0)) / total) * 100}%` }}
          />
        </div>
      </div>

      <h3 className="font-serif-editorial text-xl leading-snug text-[#1C1917] dark:text-[#F5F2EB]">{q.question}</h3>

      <div className="space-y-2">
        {q.options.map((option, oi) => {
          const correct = oi === q.answer_index;
          let tone =
            "border-[#E6E1D6] bg-[#FFFFFF] hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#D97757]/60";
          if (done && correct) tone = "border-emerald-600/60 bg-emerald-500/10";
          else if (done && oi === choice) tone = "border-red-500/60 bg-red-500/10";
          else if (done) tone = "border-[#E6E1D6] bg-[#FFFFFF] opacity-60 dark:border-[#2A2826] dark:bg-[#1C1B19]";
          return (
            <button
              key={oi}
              type="button"
              disabled={done}
              onClick={() => setPicked((p) => ({ ...p, [index]: oi }))}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm text-[#292524] transition disabled:cursor-default dark:text-[#E7E5E4] ${tone}`}
            >
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#F3EFEA] text-[11px] font-semibold text-[#57534E] dark:bg-[#2C2926] dark:text-[#A8A29E]"
              >
                {LETTERS[oi]}
              </span>
              <span className="flex-1">{option}</span>
              {done && correct && <FiCheckCircle className="shrink-0 text-emerald-600" size={17} />}
              {done && !correct && oi === choice && <FiXCircle className="shrink-0 text-red-500" size={17} />}
            </button>
          );
        })}
      </div>

      {done && q.explanation && (
        <p className="fade-up rounded-2xl bg-[#F3EFEA] px-4 py-3 text-sm leading-relaxed text-[#57534E] dark:bg-[#22201E] dark:text-[#A8A29E]">
          {q.explanation}
        </p>
      )}

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0} className={PILL_BTN}>
          <FiArrowLeft size={14} /> Back
        </button>
        {last ? (
          <button type="button" onClick={() => setFinished(true)} disabled={answered < total} className={PRIMARY_BTN}>
            See results
          </button>
        ) : (
          <button type="button" onClick={() => setIndex((i) => i + 1)} disabled={!done} className={PRIMARY_BTN}>
            Next <FiArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}