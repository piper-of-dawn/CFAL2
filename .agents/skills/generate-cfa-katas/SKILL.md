---
name: generate-cfa-katas
description: Generate source-locked CFA practice questions from a curriculum PDF and TOML configuration through transcription, learning-outcome mapping, kata generation, numerical Python verification, and strict JSON sanitization. Use when asked to run, resume, validate, or troubleshoot the autonomous CFA kata pipeline or publish src/data/questions.json from an lm*.toml file.
---

# Generate CFA Katas

Run a four-agent pipeline. Treat the configured PDF as the only content
authority. Fail rather than complete a question with model knowledge or an
unstated assumption.

## Before Delegating

1. Read `references/contracts.md` completely.
2. Resolve the config path relative to the repository root.
3. Run:

```bash
.venv/bin/python .agents/skills/generate-cfa-katas/scripts/pipeline.py prepare --config lm1-fi.toml
```

Stop on any nonzero exit. Use the returned absolute paths in all subagent
prompts.

## Orchestration

Run these roles sequentially. Do not start a downstream role before its input
artifact validates. Give each role only its contract, input paths, config path,
and the PDF-only authority rule.

### 1. transcription-agent

Run `pipeline.py transcribe --config <config>`. Return `created` or `reused`,
the transcript path, and metadata path.

### 2. mapper-agent

Give it the transcript path. Require it to locate the configured module from
actual headings, copy learning outcomes verbatim in curriculum order, and
assign complete source text with page ranges. It writes
`learning-outcomes.json`, then runs `pipeline.py validate-map --config <config>
--input <map>`.

If `learning-outcomes.json` already exists, run `validate-map` before doing
mapping work. A `reused` result is the final mapper result; a validation failure
requires regeneration.

Stop if boundaries are ambiguous, text is missing, or coverage has unexplained
gaps. Never summarize source text in the map.

### 3. kata-generator-agent

Generate one candidate at a time and exactly `katas` candidates per learning
outcome. Every candidate tests one primitive and carries the private evidence
contract from `references/contracts.md`.

For every numerical candidate:

1. Write a temporary Python program under the run directory returned by
   `prepare`.
2. Put every stem input in that program and compute the answer independently.
3. Run `pipeline.py run-python --config <config> --script <temporary.py>
   --expected <answer>`.

The command deletes the program and does not retain stdout. If a package is
genuinely necessary, install it only into `.venv` with `uv pip install --python
.venv/bin/python <package>`. Prefer `decimal`, `fractions`, `math`, and
`statistics`. Package authority is computational, never permission to import
concepts absent from the PDF.

Write candidates to `questions.raw.json`.

### 4. json-sanitizer-agent

Audit every technical noun, assumption, formula, answer, and distractor against
the private source excerpt. Reject unsupported or multi-primitive questions.
Correct representation only; never repair financial meaning silently.

After semantic approval, run `pipeline.py publish --config <config> --map <map>
--input <raw-questions>`. The command strips private evidence, validates exact
public structure and four-block HTML, reparses the written JSON, and atomically
replaces the output.

## Stop Conditions

- Never publish fewer or more than `learning outcomes × katas`.
- Never infer missing module boundaries or learning outcomes.
- Never use prior-question context, external conventions, or invented inputs.
- Never call a numerical candidate verified unless `run-python` succeeds.
- Never preserve temporary numerical programs or their stdout.
- Report the failing stage, artifact path, and validation error.
