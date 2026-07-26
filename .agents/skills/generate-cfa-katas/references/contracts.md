# CFA Kata Pipeline Contracts

## Authority

The configured PDF is the sole content authority. A term, assumption, formula,
condition, example, correct answer, or distractor is allowed only when explicitly
present or directly implied by the mapped source excerpt.

## Learning-outcome map

Write a JSON array in curriculum order:

```json
[
  {
    "id": "lm01-lo01",
    "learning_outcome": "Verbatim learning outcome",
    "pages": {"start": 1, "end": 3},
    "source_text": "Complete assigned page-delimited source text"
  }
]
```

IDs must be unique. Page ranges must be positive and ordered. `source_text` must
include the stable page markers emitted by transcription and must not be a
summary.

## Raw question

Write a JSON array. Each object has the five public fields plus private evidence:

```json
{
  "topic": "One primitive",
  "stem": "Self-contained question",
  "options": ["A text", "B text", "C text"],
  "answer": 0,
  "explanation": "<h3>First Principles Thinking: core idea</h3><p><strong>A is correct.</strong> Source-grounded reasoning.</p><p>Why the other options are wrong</p><p><strong>B:</strong> Source-grounded error. <strong>C:</strong> Source-grounded error.</p>",
  "_evidence": {
    "learning_outcome_id": "lm01-lo01",
    "source_pages": {"start": 1, "end": 2},
    "source_excerpt": "Exact supporting excerpt",
    "primitive": "The single tested building block",
    "correct_derivation": "Derivation using only the excerpt",
    "distractor_basis": ["Why option B follows a primitive error", "Why option C follows a primitive error"],
    "numerical": false,
    "python_verified": false
  }
}
```

For a numerical question, both boolean fields must be `true`. The excerpt must
contain or directly imply every rule and condition used. Every number needed to
solve the question must appear in the stem.

## Public question

Publishing removes `_evidence`. No other public keys are allowed. The explanation
blocks are exactly:

1. `<h3>First Principles Thinking: core idea</h3>`
2. `<p><strong>X is correct.</strong> ...</p>`
3. `<p>Why the other options are wrong</p>`
4. `<p><strong>Y:</strong> ... <strong>Z:</strong> ...</p>`

Only `h3`, `p`, and `strong` are permitted. `X` is the correct option letter;
`Y` and `Z` are the other option letters.

## Question standard

- Test exactly one primitive building block.
- Use exactly three options and one unambiguous answer.
- Minimize cognitive load.
- Keep numerical arithmetic mental-math friendly.
- Make every question independent and self-contained.
- Derive distractors from close, source-supported primitive mistakes.
- Use occasional confusion only through close distractors, never omitted facts.
