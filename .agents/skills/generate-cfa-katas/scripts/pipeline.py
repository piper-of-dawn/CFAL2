#!/usr/bin/env python3
"""Deterministic artifact layer for the source-locked CFA kata skill."""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from typing import Any

SCHEMA_VERSION = "1"
TRANSCRIPT_VERSION = "pdftotext-layout-v1"
MAP_VERSION = "source-map-v1"
PUBLIC_KEYS = {"topic", "stem", "options", "answer", "explanation"}
RAW_KEYS = PUBLIC_KEYS | {"_evidence"}
EVIDENCE_KEYS = {
    "learning_outcome_id",
    "source_pages",
    "source_excerpt",
    "primitive",
    "correct_derivation",
    "distractor_basis",
    "numerical",
    "python_verified",
}
PAGE_MARKER = re.compile(r"^===== PAGE (\d+) =====$", re.MULTILINE)


class PipelineError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise PipelineError(message)


def atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def atomic_json(path: Path, value: Any) -> None:
    atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot parse JSON {path}: {exc}")


def contained_path(repo: Path, raw: str, label: str) -> Path:
    candidate = (repo / raw).resolve()
    try:
        candidate.relative_to(repo)
    except ValueError:
        fail(f"{label} must resolve inside the repository: {candidate}")
    return candidate


def load_config(config_path: Path) -> dict[str, Any]:
    config_path = config_path.resolve()
    repo = config_path.parent
    try:
        data = tomllib.loads(config_path.read_text(encoding="utf-8"))
        pdf = Path(data["file"]["path"]).expanduser().resolve()
        lm = data["file"]["lm"]
        katas = data["requirements-for-each-lm"]["katas"]
        vignette = data["requirements-for-each-lm"]["vignette"]
        output_raw = data["output"]["path"]
    except (OSError, UnicodeError, tomllib.TOMLDecodeError, KeyError, TypeError) as exc:
        fail(f"invalid config {config_path}: {exc}")

    if not pdf.is_file():
        fail(f"configured PDF does not exist: {pdf}")
    if not isinstance(lm, int) or isinstance(lm, bool) or lm < 1:
        fail("file.lm must be a positive integer")
    if not isinstance(katas, int) or isinstance(katas, bool) or katas < 1:
        fail("requirements-for-each-lm.katas must be a positive integer")
    if not isinstance(vignette, int) or isinstance(vignette, bool) or vignette < 0:
        fail("requirements-for-each-lm.vignette must be a non-negative integer")
    if not isinstance(output_raw, str) or not output_raw.strip():
        fail("output.path must be a non-empty string")

    output = contained_path(repo, output_raw, "output.path")
    data_root = (repo / "src" / "data").resolve()
    try:
        output.relative_to(data_root)
    except ValueError:
        fail(f"output.path must resolve inside {data_root}")
    if output.suffix != ".json":
        fail("output.path must name a .json file")

    run_dir = repo / ".generated" / "cfa-kata-pipeline" / f"lm-{lm:02d}"
    venv_python = repo / ".venv" / "bin" / "python"
    for executable in ("pdftotext", "pdfinfo"):
        if shutil.which(executable) is None:
            fail(f"required executable is unavailable: {executable}")
    if not venv_python.is_file():
        fail(f"repo virtual environment is missing: {venv_python}")

    return {
        "config": config_path,
        "repo": repo,
        "pdf": pdf,
        "lm": lm,
        "katas": katas,
        "vignette": vignette,
        "output": output,
        "run_dir": run_dir,
        "venv_python": venv_python,
    }


def update_manifest(config: dict[str, Any], stage: str, payload: dict[str, Any]) -> None:
    path = config["run_dir"] / "run-manifest.json"
    current = read_json(path) if path.exists() else {}
    current.setdefault("stages", {})[stage] = payload
    current.update(
        {
            "schema_version": SCHEMA_VERSION,
            "config": str(config["config"]),
            "pdf": str(config["pdf"]),
            "pdf_sha256": sha256(config["pdf"]),
            "lm": config["lm"],
            "katas_per_learning_outcome": config["katas"],
            "warnings": [
                "requirements-for-each-lm.vignette is accepted but unused in v1"
            ]
            if config["vignette"]
            else [],
            "output": str(config["output"]),
        }
    )
    atomic_json(path, current)


def command_prepare(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(Path(args.config))
    temporary = config["run_dir"] / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": "ready",
        "run_dir": str(config["run_dir"]),
        "temporary_dir": str(temporary),
        "transcript": str(config["run_dir"] / "transcript.txt"),
        "map": str(config["run_dir"] / "learning-outcomes.json"),
        "raw_questions": str(config["run_dir"] / "questions.raw.json"),
        "output": str(config["output"]),
        "warning": "vignette is accepted but unused in v1"
        if config["vignette"]
        else None,
    }
    update_manifest(config, "prepare", payload)
    return payload


def pdf_pages(pdf: Path) -> int:
    result = subprocess.run(
        ["pdfinfo", str(pdf)], capture_output=True, text=True, check=False
    )
    if result.returncode:
        fail(f"pdfinfo failed: {result.stderr.strip()}")
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    if not match:
        fail("pdfinfo did not report a page count")
    return int(match.group(1))


def command_transcribe(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(Path(args.config))
    run_dir = config["run_dir"]
    run_dir.mkdir(parents=True, exist_ok=True)
    transcript = run_dir / "transcript.txt"
    metadata = run_dir / "transcript.meta.json"
    fingerprint = {
        "pdf_sha256": sha256(config["pdf"]),
        "pdf_pages": pdf_pages(config["pdf"]),
        "version": TRANSCRIPT_VERSION,
    }
    if transcript.exists() and metadata.exists() and read_json(metadata) == fingerprint:
        markers = PAGE_MARKER.findall(transcript.read_text(encoding="utf-8"))
        if len(markers) == fingerprint["pdf_pages"]:
            payload = {
                "status": "reused",
                "transcript": str(transcript),
                "metadata": str(metadata),
            }
            update_manifest(config, "transcription-agent", payload)
            return payload

    with tempfile.TemporaryDirectory(dir=run_dir) as temporary:
        extracted = Path(temporary) / "raw.txt"
        result = subprocess.run(
            ["pdftotext", "-layout", str(config["pdf"]), str(extracted)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            fail(f"pdftotext failed: {result.stderr.strip()}")
        raw = extracted.read_text(encoding="utf-8", errors="strict")

    pages = raw.replace("\r\n", "\n").replace("\r", "\n").split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    if len(pages) != fingerprint["pdf_pages"]:
        fail(
            f"transcription page mismatch: expected {fingerprint['pdf_pages']}, "
            f"got {len(pages)}"
        )
    if sum(len(page.strip()) for page in pages) < 1000:
        fail("transcription is suspiciously empty")
    rendered = "\n\n".join(
        f"===== PAGE {index} =====\n{page.rstrip()}"
        for index, page in enumerate(pages, 1)
    )
    atomic_text(transcript, rendered + "\n")
    atomic_json(metadata, fingerprint)
    payload = {
        "status": "created",
        "transcript": str(transcript),
        "metadata": str(metadata),
        "pages": len(pages),
    }
    update_manifest(config, "transcription-agent", payload)
    return payload


def validate_page_range(value: Any, label: str) -> tuple[int, int]:
    if not isinstance(value, dict) or set(value) != {"start", "end"}:
        fail(f"{label} must have exactly start and end")
    start, end = value["start"], value["end"]
    if (
        not isinstance(start, int)
        or isinstance(start, bool)
        or not isinstance(end, int)
        or isinstance(end, bool)
        or start < 1
        or end < start
    ):
        fail(f"{label} is invalid")
    return start, end


def command_validate_map(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(Path(args.config))
    path = Path(args.input).resolve()
    expected = (config["run_dir"] / "learning-outcomes.json").resolve()
    if path != expected:
        fail(f"map must be written to {expected}")
    data = read_json(path)
    if not isinstance(data, list) or not data:
        fail("learning-outcome map must be a non-empty array")
    seen: set[str] = set()
    for index, item in enumerate(data):
        if not isinstance(item, dict) or set(item) != {
            "id",
            "learning_outcome",
            "pages",
            "source_text",
        }:
            fail(f"map item {index} has an invalid shape")
        for field in ("id", "learning_outcome", "source_text"):
            if not isinstance(item[field], str) or not item[field].strip():
                fail(f"map item {index}.{field} must be non-empty")
        if item["id"] in seen:
            fail(f"duplicate learning-outcome id: {item['id']}")
        seen.add(item["id"])
        start, end = validate_page_range(item["pages"], f"map item {index}.pages")
        markers = [int(value) for value in PAGE_MARKER.findall(item["source_text"])]
        if not markers or min(markers) < start or max(markers) > end:
            fail(f"map item {index} source markers do not match its page range")
    transcript = config["run_dir"] / "transcript.txt"
    if not transcript.is_file():
        fail("transcript must exist before map validation")
    meta_path = config["run_dir"] / "learning-outcomes.meta.json"
    meta = {
        "version": MAP_VERSION,
        "lm": config["lm"],
        "transcript_sha256": sha256(transcript),
        "map_sha256": sha256(path),
        "learning_outcomes": len(data),
    }
    reused = meta_path.exists() and read_json(meta_path) == meta
    atomic_json(meta_path, meta)
    payload = {
        "status": "reused" if reused else "validated",
        "map": str(path),
        **meta,
    }
    update_manifest(config, "mapper-agent", payload)
    return payload


def command_run_python(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(Path(args.config))
    script = Path(args.script).resolve()
    temporary_root = (config["run_dir"] / "tmp").resolve()
    try:
        script.relative_to(temporary_root)
    except ValueError:
        fail(f"numerical script must be inside {temporary_root}")
    if script.suffix != ".py" or not script.is_file():
        fail("numerical script must be an existing .py file")

    try:
        result = subprocess.run(
            [str(config["venv_python"]), "-I", str(script)],
            cwd=config["repo"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"},
        )
        if result.returncode:
            fail(f"numerical verification failed with exit code {result.returncode}")
        actual = result.stdout.strip()
        if actual != args.expected:
            fail(
                f"numerical result mismatch: expected {args.expected!r}, got {actual!r}"
            )
    finally:
        script.unlink(missing_ok=True)

    packages = subprocess.run(
        [
            str(config["venv_python"]),
            "-I",
            "-c",
            (
                "import importlib.metadata as m;"
                "print('\\n'.join(sorted("
                "f'{d.metadata[\"Name\"]}=={d.version}' for d in m.distributions()"
                " if d.metadata['Name'])))"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    payload = {
        "status": "verified",
        "python": str(config["venv_python"]),
        "packages": sorted(line for line in packages.stdout.splitlines() if line),
        "script_retained": False,
        "stdout_retained": False,
    }
    update_manifest(config, "python-verification", payload)
    return payload


class ExplanationParser(HTMLParser):
    allowed = {"h3", "p", "strong"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.top: list[str] = []
        self.text_by_top: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag not in self.allowed or attrs:
            fail(f"explanation contains forbidden HTML: <{tag}>")
        if not self.stack:
            self.top.append(tag)
            self.text_by_top.append("")
        self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if not self.stack or self.stack[-1] != tag:
            fail(f"explanation has unbalanced HTML near </{tag}>")
        self.stack.pop()

    def handle_data(self, data: str) -> None:
        if not self.stack and data.strip():
            fail("explanation contains text outside top-level blocks")
        if self.stack:
            self.text_by_top[-1] += data

    def validate(self) -> None:
        if self.stack:
            fail("explanation contains unclosed HTML")
        if self.top != ["h3", "p", "p", "p"]:
            fail("explanation must contain exactly h3, p, p, p at top level")
        if self.text_by_top[0].strip() != "First Principles Thinking: core idea":
            fail("explanation heading is not exact")
        if self.text_by_top[2].strip() != "Why the other options are wrong":
            fail("explanation third block is not exact")


def validate_text(value: str, label: str) -> None:
    if "\ufffd" in value or any(
        ord(character) < 32 and character not in "\n\t" for character in value
    ):
        fail(f"{label} contains invalid characters")
    unescaped_dollars = re.findall(r"(?<!\\)\$", value)
    if len(unescaped_dollars) % 2:
        fail(f"{label} has unbalanced LaTeX dollar delimiters")


def option_letter(index: int) -> str:
    return chr(ord("A") + index)


def validate_question(item: Any, index: int, lo_ids: set[str]) -> dict[str, Any]:
    label = f"question {index}"
    if not isinstance(item, dict) or set(item) != RAW_KEYS:
        fail(f"{label} must have exactly the five public fields and _evidence")
    for field in ("topic", "stem", "explanation"):
        if not isinstance(item[field], str) or not item[field].strip():
            fail(f"{label}.{field} must be non-empty")
        validate_text(item[field], f"{label}.{field}")
    options = item["options"]
    if (
        not isinstance(options, list)
        or len(options) != 3
        or any(not isinstance(value, str) or not value.strip() for value in options)
        or len(set(value.strip().casefold() for value in options)) != 3
    ):
        fail(f"{label}.options must contain three unique non-empty strings")
    answer = item["answer"]
    if not isinstance(answer, int) or isinstance(answer, bool) or answer not in range(3):
        fail(f"{label}.answer must be 0, 1, or 2")

    parser = ExplanationParser()
    parser.feed(item["explanation"])
    parser.close()
    parser.validate()
    correct = option_letter(answer)
    wrong = [option_letter(value) for value in range(3) if value != answer]
    if not parser.text_by_top[1].lstrip().startswith(f"{correct} is correct."):
        fail(f"{label} explanation does not name the correct option")
    for letter in wrong:
        if f"{letter}:" not in parser.text_by_top[3]:
            fail(f"{label} explanation does not address option {letter}")

    evidence = item["_evidence"]
    if not isinstance(evidence, dict) or set(evidence) != EVIDENCE_KEYS:
        fail(f"{label} has invalid private evidence")
    for field in (
        "learning_outcome_id",
        "source_excerpt",
        "primitive",
        "correct_derivation",
    ):
        if not isinstance(evidence[field], str) or not evidence[field].strip():
            fail(f"{label}._evidence.{field} must be non-empty")
    if evidence["learning_outcome_id"] not in lo_ids:
        fail(f"{label} refers to an unknown learning outcome")
    validate_page_range(evidence["source_pages"], f"{label} source_pages")
    bases = evidence["distractor_basis"]
    if (
        not isinstance(bases, list)
        or len(bases) != 2
        or any(not isinstance(value, str) or not value.strip() for value in bases)
    ):
        fail(f"{label} needs two distractor bases")
    if not isinstance(evidence["numerical"], bool) or not isinstance(
        evidence["python_verified"], bool
    ):
        fail(f"{label} numerical flags must be booleans")
    if evidence["numerical"] and not evidence["python_verified"]:
        fail(f"{label} is numerical but lacks Python verification")

    return {
        key: item[key]
        for key in ("topic", "stem", "options", "answer", "explanation")
    }


def command_publish(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(Path(args.config))
    map_data = read_json(Path(args.map).resolve())
    if not isinstance(map_data, list) or not map_data:
        fail("validated learning-outcome map is required")
    lo_ids = {item.get("id") for item in map_data if isinstance(item, dict)}
    if None in lo_ids or len(lo_ids) != len(map_data):
        fail("learning-outcome map IDs are invalid")

    raw = read_json(Path(args.input).resolve())
    if not isinstance(raw, list):
        fail("raw questions must be an array")
    expected = len(lo_ids) * config["katas"]
    if len(raw) != expected:
        fail(f"expected {expected} questions, received {len(raw)}")

    counts = {value: 0 for value in lo_ids}
    public: list[dict[str, Any]] = []
    stems: set[str] = set()
    for index, item in enumerate(raw):
        public_item = validate_question(item, index, lo_ids)
        lo_id = item["_evidence"]["learning_outcome_id"]
        counts[lo_id] += 1
        normalized = re.sub(r"\W+", " ", public_item["stem"]).strip().casefold()
        if normalized in stems:
            fail(f"duplicate question stem at index {index}")
        stems.add(normalized)
        public.append(public_item)
    incorrect = {
        key: count for key, count in counts.items() if count != config["katas"]
    }
    if incorrect:
        fail(f"incorrect per-outcome question counts: {incorrect}")

    atomic_json(config["output"], public)
    if read_json(config["output"]) != public:
        fail("published output failed parse-after-write verification")
    payload = {
        "status": "published",
        "output": str(config["output"]),
        "questions": len(public),
        "learning_outcomes": len(lo_ids),
        "sha256": sha256(config["output"]),
    }
    update_manifest(config, "json-sanitizer-agent", payload)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "transcribe"):
        command = commands.add_parser(name)
        command.add_argument("--config", required=True)
    validate_map = commands.add_parser("validate-map")
    validate_map.add_argument("--config", required=True)
    validate_map.add_argument("--input", required=True)
    run_python = commands.add_parser("run-python")
    run_python.add_argument("--config", required=True)
    run_python.add_argument("--script", required=True)
    run_python.add_argument("--expected", required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("--config", required=True)
    publish.add_argument("--map", required=True)
    publish.add_argument("--input", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    handlers = {
        "prepare": command_prepare,
        "transcribe": command_transcribe,
        "validate-map": command_validate_map,
        "run-python": command_run_python,
        "publish": command_publish,
    }
    try:
        payload = handlers[args.command](args)
    except PipelineError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
