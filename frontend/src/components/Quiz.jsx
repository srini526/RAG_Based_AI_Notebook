import { useState } from "react";
import { FiCheckCircle, FiXCircle } from "react-icons/fi";

export default function Quiz({ quiz }) {
  const [picked, setPicked] = useState({}); // question index -> chosen option index
  const total = quiz.questions.length;
  const answered = Object.keys(picked).length;
  const score = quiz.questions.filter((q, i) => picked[i] === q.answer_index).length;

  return (
    <div className="space-y-4">
      {quiz.questions.map((q, qi) => {
        const choice = picked[qi];
        const done = choice !== undefined;
        return (
          <fieldset
            key={qi}
            className="rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] p-4 dark:border-[#2A2826] dark:bg-[#1C1B19]"
          >
            <legend className="px-1 text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
              {qi + 1}. {q.question}
            </legend>
            <div className="mt-2 space-y-1.5">
              {q.options.map((option, oi) => {
                const correct = oi === q.answer_index;
                let tone =
                  "border-[#E6E1D6] hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:hover:border-[#D97757]/60";
                if (done && correct) tone = "border-emerald-600/60 bg-emerald-500/10";
                else if (done && oi === choice) tone = "border-red-500/60 bg-red-500/10";
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={done}
                    onClick={() => setPicked((p) => ({ ...p, [qi]: oi }))}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm text-[#292524] transition disabled:cursor-default dark:text-[#E7E5E4] ${tone} ${done ? "" : "cursor-pointer"}`}
                  >
                    <span>{option}</span>
                    {done && correct && <FiCheckCircle className="shrink-0 text-emerald-600" size={15} />}
                    {done && !correct && oi === choice && (
                      <FiXCircle className="shrink-0 text-red-500" size={15} />
                    )}
                  </button>
                );
              })}
            </div>
            {done && q.explanation && (
              <p className="mt-2 text-xs leading-relaxed text-[#57534E] dark:text-[#A8A29E]">{q.explanation}</p>
            )}
          </fieldset>
        );
      })}
      {answered === total && (
        <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
          Score: {score} / {total}
        </p>
      )}
    </div>
  );
}
