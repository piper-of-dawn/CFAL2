import QuizShell from "./quiz-shell";
import { validateQuestions } from "./question-content";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dataDirectory = path.join(process.cwd(), "src", "data");

function titleFromFilename(filename: string) {
  return filename
    .replace(/\.json$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function getQuestionSets() {
  const filenames = (await readdir(dataDirectory))
    .filter((filename) => filename.endsWith(".json"))
    .sort((first, second) => first.localeCompare(second));

  return Promise.all(
    filenames.map(async (filename) => {
      try {
        const source = await readFile(path.join(dataDirectory, filename), "utf8");
        const parsed = JSON.parse(source);
        const dataset = validateQuestions(parsed);

        return {
          id: filename,
          label: titleFromFilename(filename),
          filename,
          questions: dataset.questions,
          error: dataset.error,
        };
      } catch (error) {
        return {
          id: filename,
          label: titleFromFilename(filename),
          filename,
          questions: [],
          error: error instanceof Error ? error.message : "The question dataset could not be parsed.",
        };
      }
    }),
  );
}

export default async function Home() {
  const questionSets = await getQuestionSets();

  return <QuizShell questionSets={questionSets} />;
}
