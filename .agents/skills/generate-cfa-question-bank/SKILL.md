---
name: generate-cfa-question-bank
description: Generate an original, source-grounded CFA Level II question bank as validated JSON from a requested topic or learning module and an exact question count. Use when the user asks for CFA questions, a question bank, practice items, item sets, or JSON quiz data by topic/count, including requests to validate or regenerate a bank produced from supplied curriculum files.
---

# Generate CFA Question Bank

Accept a topic and question count, resolve the topic against supplied CFA
curriculum material, generate the complete bank, and release only questions that
pass grounding, originality, numerical, style, single-answer, and JSON-schema
checks.

## Inputs

Require only:

- `topic`: a learning-module number/title or an unambiguous topic within one.
- `question_count`: an integer from 1 through 200.

Accept optional source paths, output path, format, difficulty, numerical weight,
solutions, choice analysis, and seed. Use the defaults in the canonical
specification when omitted. Prefer standalone questions for a small or awkward
count that cannot form four- or six-question item sets; otherwise retain the
specification's item-set default.

Proceed without clarification when the topic resolves uniquely. Ask one focused
question only if multiple modules remain plausible after inspecting the supplied
sources.

## Load the Contract

Before generating anything, locate the repository root and read
`.codex/cfa_l2_multi_agent_question_bank_skill_v2.json` completely. Treat its
operating principles, output schema, acceptance tests, and error schema as the
canonical contract. Do not weaken its gates to satisfy the requested count.

Use the requested topic as `learning_module` when it names a module. When it
names a narrower concept, locate that concept inside a single module, record the
official parent module in metadata, and constrain the coverage plan to the
requested topic.

## Resolve Sources

1. Inspect explicit source paths first.
2. Otherwise inspect repository `lm*.toml` files, their configured PDFs, and
   existing `.generated/` transcripts or maps.
3. Match internal headings, Learning Outcome Statements (LOS), and instructional
   content; never identify a module from a filename alone.
4. Treat the resolved curriculum material as the only authority. Do not fill
   source gaps with model knowledge or web sources.
5. Inspect rendered PDF pages for ambiguous formulas, tables, or exhibits.

Stop with the specification's structured error JSON if the topic cannot be
located, source support is insufficient, or a required extraction remains
ambiguous.

## Execute the Workflow

Use the specification's staged architecture. When parallel agents are
available, delegate independent audits without disclosing the generator's
answer or rationale where the information barriers prohibit it.

1. Map the module and requested topic. Build LOS, concept, formula, assumption,
   and convention registries with private source evidence.
2. Allocate exactly `question_count` items across supported LOS and distinct
   tested primitives. Balance A/B/C answer positions across the whole bank.
3. Generate original scenarios, entities, values, exhibits, choices, solutions,
   and named distractor mechanisms. Changing only names and numbers from a
   source item is not original.
4. For every numerical item, compute the locked answer and every distractor
   using deterministic executable calculation. Independently recompute the
   result by another method before inspecting the proposed answer key.
5. Audit source grounding/originality, CFA-style construction, and exactly one
   defensible answer independently. Regenerate failed numerical or originality
   items from new primitive inputs; do not patch their answer keys.
6. Run the bank-level coverage, duplication, answer-balance, and count checks.
   Release fewer questions only when the contract requires rejecting failures;
   report the shortfall rather than including a failed item.

Keep source excerpts, calculation code, and audit notes private. The public JSON
must contain only fields allowed by `question_bank_output_schema`.

## Save and Validate

Write UTF-8 JSON atomically to the requested output path. If none is supplied,
use `outputs/question-banks/<topic-slug>-<question-count>.json`; add a numeric
suffix instead of overwriting an unrelated existing artifact.

Validate the final artifact with the repository interpreter when it provides
`jsonschema`; otherwise use the system interpreter:

```bash
if .venv/bin/python -c 'import jsonschema' 2>/dev/null; then
  .venv/bin/python .agents/skills/generate-cfa-question-bank/scripts/validate_question_bank.py \
    <output.json> --expected-count <question_count>
else
  python .agents/skills/generate-cfa-question-bank/scripts/validate_question_bank.py \
    <output.json> --expected-count <question_count>
fi
```

A nonzero exit is a release failure. Fix or regenerate the affected items,
rerun every relevant audit, and validate again.

When filesystem access is available, return the output path, released count,
rejected/regenerated counts, and validation status. Do not paste the full bank
unless requested. Without filesystem access, return only the valid JSON document
with no Markdown fences or surrounding prose.
