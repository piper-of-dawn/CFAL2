import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

type QuestionStatsRow = {
  question_id: string;
  wrong_count: number | string;
};

let pool: Pool | null = null;
let tableReady = false;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool ??= new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  return pool;
}

async function ensureTable(db: Pool) {
  if (tableReady) return;

  await db.query(`
    create table if not exists question_stats (
      student_id text not null,
      set_id text not null,
      question_id text not null,
      wrong_count integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (student_id, set_id, question_id)
    )
  `);
  tableReady = true;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const setId = searchParams.get("setId");
  const studentId = searchParams.get("studentId") ?? "default";
  if (!setId) {
    return NextResponse.json({ error: "setId is required" }, { status: 400 });
  }

  const db = getPool();
  if (!db) {
    return NextResponse.json({ counts: {} });
  }

  await ensureTable(db);
  const result = await db.query<QuestionStatsRow>(
    "select question_id, wrong_count from question_stats where student_id = $1 and set_id = $2",
    [studentId, setId],
  );
  const counts = Object.fromEntries(
    result.rows.map((row) => [row.question_id, Number(row.wrong_count)]),
  );

  return NextResponse.json({ counts });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { studentId?: unknown; setId?: unknown; questionId?: unknown }
    | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId : "default";
  const setId = typeof body?.setId === "string" ? body.setId : "";
  const questionId = typeof body?.questionId === "string" ? body.questionId : "";

  if (!setId || !questionId) {
    return NextResponse.json({ error: "setId and questionId are required" }, { status: 400 });
  }

  const db = getPool();
  if (!db) {
    return NextResponse.json({ skipped: true, reason: "DATABASE_URL is not configured" });
  }

  await ensureTable(db);
  const result = await db.query<QuestionStatsRow>(
    `
      insert into question_stats (student_id, set_id, question_id, wrong_count)
      values ($1, $2, $3, 1)
      on conflict (student_id, set_id, question_id)
      do update set
        wrong_count = question_stats.wrong_count + 1,
        updated_at = now()
      returning question_id, wrong_count
    `,
    [studentId, setId, questionId],
  );

  return NextResponse.json({
    questionId: result.rows[0].question_id,
    wrongCount: Number(result.rows[0].wrong_count),
  });
}
