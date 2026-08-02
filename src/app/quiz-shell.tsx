"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "@appica/ui-react/badge";
import { Button } from "@appica/ui-react/button";
import { Progress } from "@appica/ui-react/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@appica/ui-react/select";
import { useTheme } from "@appica/ui-react/hooks/use-theme";
import { getQuestionId } from "@/lib/question-id";
import type { PracticeGroup } from "./question-content";
import { ExhibitView, Explanation, MathText } from "./question-content";

type QuestionSet = {
  id: string;
  label: string;
  filename: string;
  groups: PracticeGroup[];
  questionCount: number;
  vignetteCount: number;
  format: "MCQ" | "Vignette";
  error: string | null;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="material-tonal rounded-3xl p-5">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-foreground-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function ThemeToggle({ theme, onChange }: { theme: "light" | "dark"; onChange: (value: "light" | "dark") => void }) {
  return (
    <div className="material-control flex items-center gap-1 rounded-full p-1" aria-label="Color theme">
      <Button className="font-mono" size="sm" variant={theme === "light" ? "primary" : "ghost"} aria-pressed={theme === "light"} onClick={() => onChange("light")}>Light</Button>
      <Button className="font-mono" size="sm" variant={theme === "dark" ? "primary" : "ghost"} aria-pressed={theme === "dark"} onClick={() => onChange("dark")}>Dark</Button>
    </div>
  );
}

export default function QuizShell({ questionSets }: { questionSets: QuestionSet[] }) {
  const [studentId, setStudentId] = useState("");
  const [selectedSetId, setSelectedSetId] = useState(questionSets[0]?.id ?? "");
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [visibleExplanations, setVisibleExplanations] = useState<Record<string, boolean>>({});
  const [wrongCounts, setWrongCounts] = useState<Record<string, number>>({});
  const [recordedWrongAnswers, setRecordedWrongAnswers] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const { resolvedTheme, setTheme, mounted } = useTheme();
  const activeTheme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  const activeSet = questionSets.find((set) => set.id === selectedSetId) ?? questionSets[0];
  const groupItems = useMemo(() => (activeSet?.groups ?? [])
    .map((group, groupIndex) => ({
      group,
      groupIndex,
      questions: group.questions.map((question, questionIndex) => ({
        id: getQuestionId(activeSet?.id ?? "", question),
        question,
        questionIndex,
      })),
    }))
    .sort((first, second) => {
      const firstWrongCount = Math.max(0, ...first.questions.map((item) => wrongCounts[item.id] ?? 0));
      const secondWrongCount = Math.max(0, ...second.questions.map((item) => wrongCounts[item.id] ?? 0));
      return secondWrongCount - firstWrongCount || first.groupIndex - second.groupIndex;
    }), [activeSet?.groups, activeSet?.id, wrongCounts]);
  const questionItems = useMemo(() => groupItems.flatMap(({ group, groupIndex, questions }) =>
    questions.map((item) => ({ ...item, group, groupIndex }))), [groupItems]);

  useEffect(() => {
    if (!started) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [started]);

  useEffect(() => {
    const storageKey = "quiz_student_id";
    const storedStudentId = window.localStorage.getItem(storageKey);
    if (storedStudentId) {
      queueMicrotask(() => setStudentId(storedStudentId));
      return;
    }

    const nextStudentId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(storageKey, nextStudentId);
    queueMicrotask(() => setStudentId(nextStudentId));
  }, []);

  useEffect(() => {
    if (!studentId || !activeSet?.id || activeSet.error) {
      return;
    }

    const abortController = new AbortController();
    fetch(`/api/question-stats?setId=${encodeURIComponent(activeSet.id)}&studentId=${encodeURIComponent(studentId)}`, {
      signal: abortController.signal,
    })
      .then((response) => (response.ok ? response.json() : { counts: {} }))
      .then((data: { counts?: Record<string, number> }) => {
        setWrongCounts(data.counts ?? {});
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setWrongCounts({});
      });

    return () => abortController.abort();
  }, [activeSet?.id, activeSet?.error, studentId]);

  const changeTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(nextTheme);
    document.documentElement.style.colorScheme = nextTheme;
  };
  const selectQuestionSet = (id: string) => {
    setSelectedSetId(id);
    setStarted(false);
    setAnswers({});
    setVisibleExplanations({});
    setWrongCounts({});
    setRecordedWrongAnswers({});
    setElapsed(0);
  };
  const startPractice = () => {
    setStarted(true);
    setAnswers({});
    setVisibleExplanations({});
    setRecordedWrongAnswers({});
    setElapsed(0);
  };
  const selectAnswer = (questionId: string, optionIndex: number, correctIndex: number) => {
    setAnswers((value) => ({ ...value, [questionId]: optionIndex }));

    if (optionIndex === correctIndex || recordedWrongAnswers[questionId] || !activeSet?.id || !studentId) return;

    setRecordedWrongAnswers((value) => ({ ...value, [questionId]: true }));
    void fetch("/api/question-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, setId: activeSet.id, questionId }),
    }).catch(() => undefined);
  };
  const toggleExplanation = (questionId: string) => {
    setVisibleExplanations((value) => ({ ...value, [questionId]: !value[questionId] }));
  };
  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const score = questionItems.reduce((total, item) => total + (answers[item.id] === item.question.answer ? 1 : 0), 0);
  const questionCount = activeSet?.questionCount ?? 0;
  const count = String(questionCount).padStart(2, "0");

  if (!activeSet) {
    return (
      <main className="grid min-h-screen place-items-center bg-background-subtle p-6 text-foreground">
        <section className="material-card max-w-xl rounded-[2rem] p-10">
          <Badge variant="soft">Dataset error</Badge>
          <h1 className="mt-5 text-3xl font-semibold">No question sets were found.</h1>
          <p className="mt-4 leading-7 text-foreground-muted">Add one or more JSON files to src/data, then restart the UI.</p>
        </section>
      </main>
    );
  }

  if (activeSet.error && started) {
    return (
      <main className="grid min-h-screen place-items-center bg-background-subtle p-6 text-foreground">
        <section className="material-card max-w-xl rounded-[2rem] p-10">
          <Badge variant="soft">Dataset error</Badge>
          <h1 className="mt-5 text-3xl font-semibold">Questions could not be loaded.</h1>
          <p className="mt-4 leading-7 text-foreground-muted">{activeSet.filename}: {activeSet.error}</p>
          <p className="mt-3 font-mono text-sm text-foreground-muted">Run the CFA kata sanitizer before starting the UI.</p>
        </section>
      </main>
    );
  }

  if (!started) {
    const canStart = !activeSet.error && questionCount > 0;

    return (
      <main className="min-h-screen bg-background-subtle text-foreground">
        <div className="quiz-grid mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-7 sm:px-10">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3"><span className="brand-mark">?</span><span className="font-mono text-lg font-semibold tracking-tight">quizcraft</span></div>
            <div className="flex items-center gap-3"><Badge variant="soft" className="font-mono">CFA practice lab</Badge><ThemeToggle theme={activeTheme} onChange={changeTheme} /></div>
          </header>
          <section className="flex flex-1 items-center py-16">
            <div className="grid w-full gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="material-card rounded-[2rem] p-7 sm:p-10">
                <Badge variant="soft" className="mb-6">JSON files in src/data</Badge>
                <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl">Select Question Set</h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-foreground-muted">Choose one of the available JSON question files before starting practice.</p>
                <label className="mt-9 block">
                  <span className="font-mono text-xs uppercase tracking-[0.16em] text-foreground-muted">Question set</span>
                  <Select
                    size="lg"
                    variant="soft"
                    value={activeSet.id}
                    onValueChange={(value) => selectQuestionSet(String(value))}
                  >
                    <SelectTrigger className="mt-3 material-control border-0 shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-0 shadow-2xl">
                      {questionSets.map((set) => (
                        <SelectItem key={set.id} value={set.id}>{set.filename}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <div className="mt-8 grid gap-3" aria-label="Available question set JSON files">
                  {questionSets.map((set) => (
                    <Button
                      key={set.id}
                      type="button"
                      variant="ghost"
                      onClick={() => selectQuestionSet(set.id)}
                      className={`material-list-item h-auto justify-start rounded-3xl p-4 text-left ${set.id === activeSet.id ? "material-list-item-active" : ""}`}
                      aria-pressed={set.id === activeSet.id}
                    >
                      <span className="flex items-center justify-between gap-4">
                        <span>
                          <span className="block font-semibold">{set.label}</span>
                          <span className="mt-1 block font-mono text-xs text-foreground-muted">{set.filename}</span>
                        </span>
                        <span className="font-mono text-sm text-foreground-muted">{set.error ? "Invalid" : set.vignetteCount ? `${set.vignetteCount} Vignettes · ${set.questionCount} Qs` : `${set.questionCount} Qs`}</span>
                      </span>
                    </Button>
                  ))}
                </div>
                {activeSet.error && <p className="material-error mt-6 rounded-3xl p-4 text-sm leading-6 text-foreground-muted">{activeSet.filename}: {activeSet.error}</p>}
                <div className="mt-9 flex flex-wrap items-center gap-4">
                  <Button size="lg" className="min-w-52" disabled={!canStart} onClick={startPractice}>Start practice <span aria-hidden="true">→</span></Button>
                  <span className="font-mono text-sm text-foreground-muted">{canStart ? `${questionCount} questions ready` : "Select a valid JSON file"}</span>
                </div>
              </div>
              <div className="relative">
                <div className="absolute -inset-8 rounded-[2.5rem] bg-foreground/5 blur-3xl" />
                <div className="material-card relative rounded-[2rem] p-7 sm:p-10">
                  <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-foreground-muted">Preview</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{activeSet.label}</h2><p className="mt-2 font-mono text-xs text-foreground-muted">{activeSet.filename}</p></div><Badge variant="soft">{canStart ? "Ready" : "Invalid"}</Badge></div>
                  <div className="mt-8 grid max-w-lg grid-cols-3 gap-4"><Stat label="Questions" value={count} /><Stat label={activeSet.vignetteCount ? "Vignettes" : "Format"} value={activeSet.vignetteCount ? String(activeSet.vignetteCount).padStart(2, "0") : activeSet.format} /><Stat label={activeSet.vignetteCount ? "Format" : "Difficulty"} value={activeSet.vignetteCount ? activeSet.format : "Core"} /></div>
                  <Progress value={0} className="mt-8" aria-label="Quiz progress" />
                  <div className="mt-9 max-h-80 space-y-2 overflow-y-auto">{groupItems.map((item, index) => <div key={item.group.id} className="material-list-item flex items-center gap-4 rounded-2xl px-3 py-4 text-sm"><span className="material-index flex size-7 items-center justify-center rounded-full text-xs font-semibold">{String(index + 1).padStart(2, "0")}</span><span><span className="block font-medium">{item.group.title}</span><span className="mt-1 block font-mono text-xs text-foreground-muted">{item.questions.length} {item.questions.length === 1 ? "question" : "questions"}</span></span></div>)}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background-subtle text-foreground">
      <div className="quiz-grid mx-auto w-full max-w-5xl px-5 py-7 sm:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4"><Button className="font-mono" variant="ghost" size="sm" onClick={() => setStarted(false)}>← Back</Button><div><p className="font-mono text-xs uppercase tracking-[0.16em] text-foreground-muted">Practice set</p><h1 className="font-semibold">{activeSet.label}</h1></div></div>
          <div className="flex items-center gap-3"><span className="font-mono text-sm text-foreground-muted">{formatTime(elapsed)}</span><ThemeToggle theme={activeTheme} onChange={changeTheme} /></div>
        </header>
        <div className="py-12">
          <div className="mb-12 grid grid-cols-3 gap-4"><Stat label="Answered" value={`${Object.keys(answers).length} / ${questionCount}`} /><Stat label="Score" value={`${score} / ${questionCount}`} /><Stat label="Time" value={formatTime(elapsed)} /></div>
          <div className="space-y-10">{questionItems.map((item, questionIndex) => {
            const { id, question, group } = item;
            const selected = answers[id];
            const checked = selected !== undefined;
            const correct = selected === question.answer;
            const explanationVisible = Boolean(visibleExplanations[id]);
            const shouldPromptExplanation = checked && !correct && !explanationVisible;
            const showVignette = group.format === "item_set" && (questionIndex === 0 || questionItems[questionIndex - 1].group.id !== group.id);
            const vignettePosition = groupItems.findIndex((candidate) => candidate.group.id === group.id) + 1;
            return (
              <Fragment key={id}>
              {showVignette && <article className="vignette-card material-card rounded-[1.75rem] p-7 sm:p-11" data-testid="vignette" data-item-set-id={group.id}>
                <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.16em] text-foreground-muted">Vignette {vignettePosition} of {activeSet.vignetteCount}</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">{group.title}</h2></div><Badge variant="soft">{group.questions.length} questions</Badge></div>
                <div className="vignette-prose mt-7 space-y-4 text-base leading-7 text-foreground-muted">{group.vignette?.split(/\n{2,}/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}><MathText>{paragraph}</MathText></p>)}</div>
                {group.exhibits.length > 0 && <div className="mt-7 grid gap-4">{group.exhibits.map((exhibit) => <ExhibitView key={exhibit.id} exhibit={exhibit} />)}</div>}
              </article>}
              <section className="material-card rounded-[1.75rem] p-7 sm:p-11" data-testid="question" data-question-id={question.trackingId}>
                <div className="flex items-center justify-between gap-4"><Badge variant="soft">{question.topic}</Badge><span className="font-mono text-sm text-foreground-muted">{String(questionIndex + 1).padStart(2, "0")} / {count}</span></div>
                <p className="mt-9 text-sm font-medium text-foreground-muted">Question {questionIndex + 1}</p>
                <h2 className="mt-3 max-w-3xl text-base font-semibold leading-snug sm:text-lg"><MathText>{question.stem}</MathText></h2>
                <div className="mt-9 grid gap-4">{question.options.map((option, optionIndex) => {
                  const chosen = selected === optionIndex;
                  const right = checked && optionIndex === question.answer;
                  const wrong = checked && chosen && !correct;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant="ghost"
                      onClick={() => selectAnswer(id, optionIndex, question.answer)}
                      className={`option-row min-h-16 justify-start text-base ${chosen ? "option-selected" : ""} ${right ? "option-correct" : ""} ${wrong ? "option-wrong" : ""}`}
                    >
                      <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span><span className="option-text text-left"><MathText>{option}</MathText></span><span className="option-status ml-auto text-xl">{right ? "✓" : wrong ? "×" : ""}</span>
                    </Button>
                  );
                })}</div>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {shouldPromptExplanation ? (
                    <Button type="button" variant="primary" onClick={() => toggleExplanation(id)}>
                      See explanation
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" className="material-control" onClick={() => toggleExplanation(id)}>
                      {explanationVisible ? "Hide explanation" : "See explanation"}
                    </Button>
                  )}
                  {checked && <Badge variant="soft">{correct ? "Correct" : "Review recommended"}</Badge>}
                </div>
                {explanationVisible && <div className="material-tonal mt-6 rounded-3xl p-6"><div className="font-semibold">{checked && correct ? "Correct answer" : "Explanation"}</div><Explanation value={question.explanation} /></div>}
              </section>
              </Fragment>
            );
          })}</div>
        </div>
      </div>
    </main>
  );
}
