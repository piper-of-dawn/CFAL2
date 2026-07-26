import katex from "katex";
import type { ReactNode } from "react";

export type Question = {
  topic: string;
  stem: string;
  options: [string, string, string];
  answer: 0 | 1 | 2;
  explanation: string;
};

const explanationPattern =
  /^<h3>First Principles Thinking: core idea<\/h3><p>([\s\S]+)<\/p><p>Why the other options are wrong<\/p><p>([\s\S]+)<\/p>$/;
const allowedInlinePattern = /^(?:[^<>]|<strong>[^<>]+<\/strong>)+$/;

function validExplanation(value: string): boolean {
  const match = value.match(explanationPattern);
  return Boolean(
    match &&
      allowedInlinePattern.test(match[1]) &&
      allowedInlinePattern.test(match[2]),
  );
}

export function validateQuestions(value: unknown):
  | { questions: Question[]; error: null }
  | { questions: []; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { questions: [], error: "The question dataset must be a non-empty array." };
  }

  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { questions: [], error: `Question ${index + 1} is not an object.` };
    }
    const item = candidate as Record<string, unknown>;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "answer,explanation,options,stem,topic") {
      return { questions: [], error: `Question ${index + 1} has an invalid shape.` };
    }
    if (
      typeof item.topic !== "string" ||
      !item.topic.trim() ||
      typeof item.stem !== "string" ||
      !item.stem.trim() ||
      !Array.isArray(item.options) ||
      item.options.length !== 3 ||
      item.options.some((option) => typeof option !== "string" || !option.trim()) ||
      !Number.isInteger(item.answer) ||
      ![0, 1, 2].includes(item.answer as number) ||
      typeof item.explanation !== "string" ||
      !validExplanation(item.explanation)
    ) {
      return {
        questions: [],
        error: `Question ${index + 1} violates the CFA question contract.`,
      };
    }
  }

  return { questions: value as Question[], error: null };
}

function renderMath(text: string): ReactNode[] {
  const pieces = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return pieces.filter(Boolean).map((piece, index) => {
    const display = piece.startsWith("$$") && piece.endsWith("$$");
    const inline = !display && piece.startsWith("$") && piece.endsWith("$");
    if (!display && !inline) return piece;
    const source = piece.slice(display ? 2 : 1, display ? -2 : -1);
    try {
      const markup = katex.renderToString(source, {
        displayMode: display,
        throwOnError: true,
        strict: "error",
        trust: false,
      });
      return (
        <span
          key={index}
          className={display ? "my-3 block overflow-x-auto" : "inline-block"}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      );
    } catch {
      return <code key={index}>{piece}</code>;
    }
  });
}

function renderInline(value: string): ReactNode[] {
  return value
    .split(/(<strong>[^<>]+<\/strong>)/g)
    .filter(Boolean)
    .map((piece, index) => {
      const match = piece.match(/^<strong>([^<>]+)<\/strong>$/);
      return match ? <strong key={index}>{renderMath(match[1])}</strong> : renderMath(piece);
    });
}

export function MathText({ children }: { children: string }) {
  return <>{renderMath(children)}</>;
}

export function Explanation({ value }: { value: string }) {
  const match = value.match(explanationPattern);
  if (!match) return null;
  return (
    <div className="explanation-content text-sm leading-7 text-foreground-muted">
      <h3>First Principles Thinking: core idea</h3>
      <p>{renderInline(match[1])}</p>
      <p>Why the other options are wrong</p>
      <p>{renderInline(match[2])}</p>
    </div>
  );
}
