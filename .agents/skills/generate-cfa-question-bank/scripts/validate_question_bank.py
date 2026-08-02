#!/usr/bin/env python3
"""Validate a CFA question-bank artifact against the registered v2 contract."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


SPEC_NAME = "cfa_l2_multi_agent_question_bank_skill_v2.json"


def find_spec(start: Path) -> Path:
    for parent in (start, *start.parents):
        candidate = parent / ".codex" / SPEC_NAME
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"could not locate .codex/{SPEC_NAME}")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def flatten_questions(bank: dict[str, Any]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    for item_set in bank.get("item_sets", []):
        questions.extend(item_set.get("questions", []))
    return questions


def format_schema_error(error: Any) -> str:
    location = ".".join(map(str, error.absolute_path)) or "<root>"
    message = error.message
    if len(message) > 500:
        message = f"{message[:497]}..."
    return f"{location}: {message}"


def semantic_errors(
    bank: dict[str, Any], questions: list[dict[str, Any]], expected_count: int | None
) -> list[str]:
    errors: list[str] = []
    metadata = bank.get("metadata", {})
    quality = bank.get("quality_control", {})
    actual_count = len(questions)

    declared_counts = {
        "metadata.question_count": metadata.get("question_count"),
        "quality_control.released_count": quality.get("released_count"),
    }
    if expected_count is not None:
        declared_counts["quality_control.requested_count"] = quality.get(
            "requested_count"
        )
    for field, value in declared_counts.items():
        target = expected_count if field.endswith("requested_count") else actual_count
        if value != target:
            errors.append(f"{field} is {value!r}; expected {target}")
    if expected_count is not None and actual_count != expected_count:
        errors.append(
            f"released question count is {actual_count}; expected {expected_count}"
        )

    ids = [question.get("question_id") for question in questions]
    duplicates = sorted(key for key, value in Counter(ids).items() if value > 1)
    if duplicates:
        errors.append(f"duplicate question_id values: {duplicates}")

    answer_counts: Counter[str] = Counter()
    for index, question in enumerate(questions, start=1):
        qid = question.get("question_id", f"question #{index}")
        choices = question.get("choices", [])
        labels = [choice.get("label") for choice in choices]
        if labels != ["A", "B", "C"]:
            errors.append(f"{qid}: choices must be ordered A, B, C")
        correct = question.get("correct_choice")
        if correct not in labels:
            errors.append(f"{qid}: correct_choice is not a choice label")
        elif correct:
            answer_counts[correct] += 1
        opening = question.get("solution", {}).get("opening", "")
        if correct and not opening.startswith(f"{correct} is correct."):
            errors.append(f"{qid}: solution opening disagrees with correct_choice")
        validation = question.get("validation", {})
        if not validation.get("overall_pass"):
            errors.append(f"{qid}: validation.overall_pass is not true")
        if not validation.get("single_answer"):
            errors.append(f"{qid}: single_answer is not true")

    expected_distribution = quality.get("answer_position_distribution", {})
    actual_distribution = {label: answer_counts[label] for label in "ABC"}
    if expected_distribution != actual_distribution:
        errors.append(
            "quality_control.answer_position_distribution does not match "
            f"actual answers {actual_distribution}"
        )

    required_true = (
        "schema_valid",
        "all_items_passed",
        "all_numerical_items_independently_recomputed",
        "all_distractors_verified",
        "all_items_module_grounded",
        "all_items_original",
        "overall_pass",
    )
    for field in required_true:
        if quality.get(field) is not True:
            errors.append(f"quality_control.{field} is not true")
    if quality.get("failed_item_ids"):
        errors.append("quality_control.failed_item_ids is not empty")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bank", type=Path, help="question-bank JSON artifact")
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--spec", type=Path, help="override the v2 specification path")
    args = parser.parse_args()

    try:
        bank_path = args.bank.resolve()
        spec_path = args.spec.resolve() if args.spec else find_spec(bank_path.parent)
        bank = load_json(bank_path)
        spec = load_json(spec_path)
        schema = spec["question_bank_output_schema"]
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        schema_errors = [
            format_schema_error(error)
            for error in sorted(validator.iter_errors(bank), key=lambda e: list(e.path))
        ]
        if isinstance(bank, dict):
            questions = flatten_questions(bank)
            errors = schema_errors + semantic_errors(
                bank, questions, args.expected_count
            )
        else:
            questions = []
            errors = schema_errors
    except (AttributeError, OSError, KeyError, TypeError, ValueError) as exc:
        errors = [str(exc)]
        questions = []
        spec_path = args.spec or Path("<unresolved>")

    result = {
        "status": "pass" if not errors else "error",
        "artifact": str(args.bank),
        "specification": str(spec_path),
        "released_count": len(questions),
        "errors": errors,
    }
    print(json.dumps(result, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
