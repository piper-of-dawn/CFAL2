import type { Question } from "@/app/question-content";

export function getQuestionId(setId: string, question: Question) {
  const source = `${setId}\n${question.topic}`;
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash.toString(36);
}
