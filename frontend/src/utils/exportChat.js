/** Turn one chat into a Markdown document (answers, quizzes and their sources). */
export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || "Study chat"}`, ""];
  for (const m of chat.messages) {
    if (m.sender === "user") {
      lines.push(`**You:** ${m.message}`, "");
      continue;
    }
    lines.push(`**Assistant:**`, "");
    if (m.message) lines.push(m.message, "");
    if (m.quiz) {
      m.quiz.questions.forEach((q, i) => {
        lines.push(`${i + 1}. ${q.question}`);
        q.options.forEach((o, j) => lines.push(`   - ${j === q.answer_index ? "**" + o + "** (correct)" : o}`));
        if (q.explanation) lines.push(`   - _${q.explanation}_`);
      });
      lines.push("");
    }
    if (m.sources?.length) {
      lines.push("Sources:");
      for (const s of m.sources) {
        lines.push(`- [${s.id}] ${s.title}${s.locator ? ` (${s.locator})` : ""}${s.url ? ` - ${s.url}` : ""}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function downloadChat(chat) {
  const blob = new Blob([chatToMarkdown(chat)], { type: "text/markdown" });
  const slug = (chat.title || "study-chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "study-chat";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slug}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}
