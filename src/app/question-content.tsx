import katex from "katex";
import type { ReactNode } from "react";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Exhibit = {
  id: string;
  title: string;
  data: JsonValue;
};

type ChoiceAnalysis = {
  label: "A" | "B" | "C";
  isCorrect: boolean;
  reason: string;
  errorMechanism: string | null;
};

export type QuestionExplanation =
  | { kind: "legacy"; html: string }
  | {
      kind: "canonical";
      opening: string;
      formulaOrRule: string;
      steps: string[];
      explanation: string;
      choiceAnalysis: ChoiceAnalysis[];
    };

export type Question = {
  trackingId?: string;
  topic: string;
  stem: string;
  options: [string, string, string];
  answer: 0 | 1 | 2;
  explanation: QuestionExplanation;
};

export type PracticeGroup = {
  id: string;
  title: string;
  format: "item_set" | "standalone";
  vignette: string | null;
  exhibits: Exhibit[];
  questions: Question[];
};

export type NormalizedQuestionDataset = {
  label: string | null;
  groups: PracticeGroup[];
  questionCount: number;
  vignetteCount: number;
  format: "MCQ" | "Vignette";
};

type DatasetResult =
  | { dataset: NormalizedQuestionDataset; error: null }
  | { dataset: null; error: string };

const explanationPattern =
  /^<h3>First Principles Thinking: core idea<\/h3><p>([\s\S]+)<\/p><p>Why the other options are wrong<\/p><p>([\s\S]+)<\/p>$/;
const allowedInlinePattern = /^(?:[^<>]|<strong>[^<>]+<\/strong>)+$/;
const choiceLabels = ["A", "B", "C"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function validExplanation(value: string): boolean {
  const match = value.match(explanationPattern);
  return Boolean(
    match &&
      allowedInlinePattern.test(match[1]) &&
      allowedInlinePattern.test(match[2]),
  );
}

function titleFromIdentifier(value: string) {
  return value
    .replace(/^vignette[-_ ]*\d+[-_ ]*/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeLegacyDataset(value: unknown): DatasetResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { dataset: null, error: "The question dataset must be a non-empty array." };
  }

  const groups: PracticeGroup[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) {
      return { dataset: null, error: `Question ${index + 1} is not an object.` };
    }
    const keys = Object.keys(candidate).sort().join(",");
    if (keys !== "answer,explanation,options,stem,topic") {
      return { dataset: null, error: `Question ${index + 1} has an invalid shape.` };
    }
    if (
      !isNonEmptyString(candidate.topic) ||
      !isNonEmptyString(candidate.stem) ||
      !Array.isArray(candidate.options) ||
      candidate.options.length !== 3 ||
      candidate.options.some((option) => !isNonEmptyString(option)) ||
      !Number.isInteger(candidate.answer) ||
      ![0, 1, 2].includes(candidate.answer as number) ||
      typeof candidate.explanation !== "string" ||
      !validExplanation(candidate.explanation)
    ) {
      return {
        dataset: null,
        error: `Question ${index + 1} violates the CFA question contract.`,
      };
    }

    const question: Question = {
      topic: candidate.topic,
      stem: candidate.stem,
      options: candidate.options as [string, string, string],
      answer: candidate.answer as 0 | 1 | 2,
      explanation: { kind: "legacy", html: candidate.explanation },
    };
    groups.push({
      id: `standalone-${index + 1}`,
      title: question.topic,
      format: "standalone",
      vignette: null,
      exhibits: [],
      questions: [question],
    });
  }

  return {
    dataset: {
      label: null,
      groups,
      questionCount: groups.length,
      vignetteCount: 0,
      format: "MCQ",
    },
    error: null,
  };
}

function normalizeCanonicalQuestion(
  value: unknown,
  position: string,
  seenQuestionIds: Set<string>,
): Question | string {
  if (!isRecord(value) || !isNonEmptyString(value.question_id)) {
    return `${position} has no valid question_id.`;
  }
  if (seenQuestionIds.has(value.question_id)) {
    return `${position} duplicates question_id ${value.question_id}.`;
  }
  seenQuestionIds.add(value.question_id);

  if (
    !isNonEmptyString(value.stem) ||
    !Array.isArray(value.concept_ids) ||
    !isNonEmptyString(value.concept_ids[0]) ||
    !Array.isArray(value.choices) ||
    value.choices.length !== 3 ||
    !choiceLabels.includes(value.correct_choice as (typeof choiceLabels)[number])
  ) {
    return `${position} has invalid content, concepts, choices, or answer.`;
  }

  const choices = value.choices
    .map((choice) => {
      if (!isRecord(choice) || !choiceLabels.includes(choice.label as (typeof choiceLabels)[number]) || !isNonEmptyString(choice.text)) {
        return null;
      }
      return { label: choice.label as (typeof choiceLabels)[number], text: choice.text };
    })
    .filter((choice): choice is { label: (typeof choiceLabels)[number]; text: string } => Boolean(choice))
    .sort((first, second) => first.label.localeCompare(second.label));
  if (choices.length !== 3 || choices.some((choice, index) => choice.label !== choiceLabels[index])) {
    return `${position} must provide each of A, B, and C exactly once.`;
  }

  const solution = value.solution;
  if (
    !isRecord(solution) ||
    !isNonEmptyString(solution.opening) ||
    !solution.opening.startsWith(`${value.correct_choice} is correct.`) ||
    !isNonEmptyString(solution.formula_or_rule) ||
    !Array.isArray(solution.steps) ||
    solution.steps.length === 0 ||
    solution.steps.some((step) => !isNonEmptyString(step)) ||
    !isNonEmptyString(solution.explanation) ||
    !Array.isArray(solution.choice_analysis) ||
    solution.choice_analysis.length !== 3
  ) {
    return `${position} has an invalid solution.`;
  }

  const choiceAnalysis = solution.choice_analysis.map((analysis) => {
    if (
      !isRecord(analysis) ||
      !choiceLabels.includes(analysis.label as (typeof choiceLabels)[number]) ||
      typeof analysis.is_correct !== "boolean" ||
      !isNonEmptyString(analysis.reason) ||
      !(analysis.error_mechanism === null || typeof analysis.error_mechanism === "string")
    ) {
      return null;
    }
    return {
      label: analysis.label as (typeof choiceLabels)[number],
      isCorrect: analysis.is_correct,
      reason: analysis.reason,
      errorMechanism: analysis.error_mechanism as string | null,
    };
  });
  if (
    choiceAnalysis.some((analysis) => analysis === null) ||
    choiceLabels.some((label) => !choiceAnalysis.some((analysis) => analysis?.label === label))
  ) {
    return `${position} has invalid choice analysis.`;
  }

  const validation = value.validation;
  if (!isRecord(validation) || validation.overall_pass !== true || validation.single_answer !== true) {
    return `${position} has not passed validation.`;
  }

  return {
    trackingId: value.question_id,
    topic: titleFromIdentifier(value.concept_ids[0]),
    stem: value.stem,
    options: choices.map((choice) => choice.text) as [string, string, string],
    answer: choiceLabels.indexOf(value.correct_choice as (typeof choiceLabels)[number]) as 0 | 1 | 2,
    explanation: {
      kind: "canonical",
      opening: solution.opening,
      formulaOrRule: solution.formula_or_rule,
      steps: solution.steps as string[],
      explanation: solution.explanation,
      choiceAnalysis: choiceAnalysis as ChoiceAnalysis[],
    },
  };
}

function normalizeCanonicalDataset(value: Record<string, unknown>): DatasetResult {
  const metadata = value.metadata;
  const qualityControl = value.quality_control;
  const itemSets = value.item_sets;
  if (
    !isRecord(metadata) ||
    !isNonEmptyString(metadata.module_title) ||
    !Number.isInteger(metadata.question_count) ||
    !isRecord(qualityControl) ||
    qualityControl.overall_pass !== true ||
    !Number.isInteger(qualityControl.released_count) ||
    !Array.isArray(itemSets) ||
    itemSets.length === 0
  ) {
    return { dataset: null, error: "The canonical question bank metadata is invalid." };
  }

  const groups: PracticeGroup[] = [];
  const seenGroupIds = new Set<string>();
  const seenQuestionIds = new Set<string>();
  for (const [groupIndex, candidate] of itemSets.entries()) {
    if (
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.item_set_id) ||
      !["item_set", "standalone"].includes(candidate.format as string) ||
      !Array.isArray(candidate.questions) ||
      candidate.questions.length === 0
    ) {
      return { dataset: null, error: `Item set ${groupIndex + 1} has an invalid shape.` };
    }
    if (seenGroupIds.has(candidate.item_set_id)) {
      return { dataset: null, error: `Duplicate item_set_id ${candidate.item_set_id}.` };
    }
    seenGroupIds.add(candidate.item_set_id);

    const format = candidate.format as "item_set" | "standalone";
    const vignette = candidate.vignette;
    if (format === "item_set" && !isNonEmptyString(vignette)) {
      return { dataset: null, error: `Item set ${groupIndex + 1} requires a vignette.` };
    }

    const exhibits: Exhibit[] = [];
    if (candidate.exhibits !== undefined) {
      if (!Array.isArray(candidate.exhibits)) {
        return { dataset: null, error: `Item set ${groupIndex + 1} has invalid exhibits.` };
      }
      for (const [exhibitIndex, exhibit] of candidate.exhibits.entries()) {
        if (!isRecord(exhibit) || !isNonEmptyString(exhibit.exhibit_id) || !isNonEmptyString(exhibit.title) || !("data" in exhibit)) {
          return { dataset: null, error: `Exhibit ${exhibitIndex + 1} in item set ${groupIndex + 1} is invalid.` };
        }
        exhibits.push({ id: exhibit.exhibit_id, title: exhibit.title, data: exhibit.data as JsonValue });
      }
    }

    const questions: Question[] = [];
    for (const [questionIndex, question] of candidate.questions.entries()) {
      const normalized = normalizeCanonicalQuestion(
        question,
        `Question ${questionIndex + 1} in item set ${groupIndex + 1}`,
        seenQuestionIds,
      );
      if (typeof normalized === "string") {
        return { dataset: null, error: normalized };
      }
      questions.push(normalized);
    }

    groups.push({
      id: candidate.item_set_id,
      title: titleFromIdentifier(candidate.item_set_id) || `Vignette ${groupIndex + 1}`,
      format,
      vignette: isNonEmptyString(vignette) ? vignette : null,
      exhibits,
      questions,
    });
  }

  const questionCount = groups.reduce((total, group) => total + group.questions.length, 0);
  if (metadata.question_count !== questionCount || qualityControl.released_count !== questionCount) {
    return { dataset: null, error: "Canonical question counts do not match the item sets." };
  }

  return {
    dataset: {
      label: metadata.module_title,
      groups,
      questionCount,
      vignetteCount: groups.filter((group) => group.format === "item_set").length,
      format: "Vignette",
    },
    error: null,
  };
}

export function normalizeQuestionDataset(value: unknown): DatasetResult {
  if (Array.isArray(value)) return normalizeLegacyDataset(value);
  if (isRecord(value) && "item_sets" in value) return normalizeCanonicalDataset(value);
  return { dataset: null, error: "The JSON file is neither a legacy question array nor a canonical question bank." };
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

function formatValue(value: JsonValue): string {
  if (value === null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function humanizeKey(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ExhibitTable({ columns, rows }: { columns: string[]; rows: JsonValue[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead><tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-semibold">{humanizeKey(column)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => (
          <tr key={rowIndex}>{columns.map((_, cellIndex) => <td key={cellIndex} className="px-4 py-3">{formatValue(row[cellIndex] ?? null)}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ExhibitData({ data }: { data: JsonValue }) {
  if (Array.isArray(data)) {
    if (data.every(Array.isArray)) {
      const rows = data as JsonValue[][];
      const width = Math.max(0, ...rows.map((row) => row.length));
      const columns = width === 2 ? ["Measure", "Value"] : Array.from({ length: width }, (_, index) => `Value ${index + 1}`);
      return <ExhibitTable columns={columns} rows={rows} />;
    }
    return <ExhibitTable columns={["Entry", "Value"]} rows={data.map((value, index) => [index + 1, value])} />;
  }

  if (!isRecord(data)) {
    return <p className="px-4 py-3 text-sm text-foreground-muted">{formatValue(data)}</p>;
  }

  if (Array.isArray(data.columns) && data.columns.every(isNonEmptyString) && Array.isArray(data.rows) && data.rows.every(Array.isArray)) {
    return <ExhibitTable columns={data.columns as string[]} rows={data.rows as JsonValue[][]} />;
  }

  if (Array.isArray(data.rows) && data.rows.every(Array.isArray)) {
    return <ExhibitData data={data.rows as JsonValue[][]} />;
  }

  const entries = Object.entries(data);
  const arrayEntries = entries.filter((entry): entry is [string, JsonValue[]] => Array.isArray(entry[1]));
  const primitiveEntries = entries.filter(([, entry]) => !Array.isArray(entry) && !isRecord(entry));
  const recordEntries = entries.filter((entry): entry is [string, Record<string, JsonValue>] => isRecord(entry[1]));
  const parallelLength = arrayEntries[0]?.[1].length ?? 0;
  const arraysAreParallel = arrayEntries.length > 1 && arrayEntries.every(([, values]) => values.length === parallelLength);

  return (
    <div>
      {primitiveEntries.length > 0 && <dl>{primitiveEntries.map(([key, entry]) => <div key={key} className="grid grid-cols-[minmax(8rem,0.7fr)_1fr] gap-4 px-4 py-3 text-sm"><dt className="font-medium text-foreground-muted">{humanizeKey(key)}</dt><dd>{formatValue(entry)}</dd></div>)}</dl>}
      {arraysAreParallel && <ExhibitTable columns={arrayEntries.map(([key]) => key)} rows={Array.from({ length: parallelLength }, (_, rowIndex) => arrayEntries.map(([, values]) => values[rowIndex]))} />}
      {!arraysAreParallel && arrayEntries.map(([key, values]) => <section key={key}><h4 className="border-t border-border px-4 py-3 text-sm font-semibold">{humanizeKey(key)}</h4><ExhibitData data={values} /></section>)}
      {recordEntries.map(([key, record]) => <section key={key}><h4 className="border-t border-border px-4 py-3 text-sm font-semibold">{humanizeKey(key)}</h4><ExhibitData data={record} /></section>)}
    </div>
  );
}

export function MathText({ children }: { children: string }) {
  return <>{renderMath(children)}</>;
}

export function ExhibitView({ exhibit }: { exhibit: Exhibit }) {
  return <section className="vignette-exhibit overflow-hidden rounded-2xl"><h3 className="px-4 py-3 text-sm font-semibold">{exhibit.title}</h3><ExhibitData data={exhibit.data} /></section>;
}

export function Explanation({ value }: { value: QuestionExplanation }) {
  if (value.kind === "canonical") {
    return (
      <div className="explanation-content text-sm leading-7 text-foreground-muted">
        <h3>First Principles Thinking: core idea</h3>
        <p><strong>{value.opening}</strong> <MathText>{value.explanation}</MathText></p>
        <p><strong>Formula or rule:</strong> <MathText>{value.formulaOrRule}</MathText></p>
        <ol className="mt-3 list-decimal space-y-2 pl-5">{value.steps.map((step, index) => <li key={index}><MathText>{step}</MathText></li>)}</ol>
        <p>Why the other options are wrong</p>
        <div className="space-y-2">{value.choiceAnalysis.filter((choice) => !choice.isCorrect).map((choice) => <p key={choice.label}><strong>{choice.label}:</strong> <MathText>{choice.reason}</MathText>{choice.errorMechanism ? <span className="block font-mono text-xs">Error mechanism: {choice.errorMechanism}</span> : null}</p>)}</div>
      </div>
    );
  }

  const match = value.html.match(explanationPattern);
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
