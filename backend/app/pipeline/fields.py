"""Stage 4: rules first, then the LLM, then the grounding check, for one invoice segment.

No database here: the LLM client is passed in (lazily, so rules-only spreadsheets never open
a Redis connection) and the result is a plain object the worker persists.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.llm.client import ExtractionClient, LLMUnavailable
from app.llm.grounding import ground, reconcile
from app.llm.injection import strip_injection
from app.llm.prompts import PROMPT_VERSION
from app.pipeline.rules import RuleResult, extract_hints, extract_table
from app.pipeline.split import Segment
from app.schemas.extraction import ExtractionResult


@dataclass
class FieldsOutcome:
    result: ExtractionResult
    method: str  # rules | llm | rules+llm
    model: str | None
    raw: dict[str, Any] = field(default_factory=dict)  # stored as invoices.raw_extraction


def _rules(segment: Segment, clean_text: str) -> RuleResult:
    if segment.table is not None:
        return extract_table(segment.table.header, segment.table.rows)
    return extract_hints(clean_text)


def _jsonable(values: dict[str, Any]) -> dict[str, Any]:
    return {k: str(v) for k, v in values.items()}


def extract_fields(
    segment: Segment,
    get_llm: Callable[[], ExtractionClient],
    *,
    final_attempt: bool,
) -> FieldsOutcome:
    """Raises LLMUnavailable (a TransientError) when no model answered, unless this is the final
    attempt: then the rule results are kept and the outcome is marked "unavailable"."""
    clean, removed = strip_injection(segment.text)
    rules = _rules(segment, clean)
    raw: dict[str, Any] = {
        "prompt_version": PROMPT_VERSION,
        "rules": _jsonable(rules.values),
        "injection_lines_removed": removed,
        "llm_status": "skipped",  # rules were enough (mapped spreadsheet columns)
    }
    grounded, model = None, None
    if not rules.complete:
        try:
            outcome = get_llm().extract(clean, rules.values, segment.page_numbers)
        except LLMUnavailable:
            if not final_attempt:
                raise
            raw["llm_status"] = "unavailable"
        else:
            report = ground(outcome.result, clean)
            grounded, model = report.result, outcome.model
            raw.update(
                llm=outcome.result.model_dump(mode="json"),  # exactly what the model said
                llm_status="cached" if outcome.cached else "ok",
                nulled_by_grounding=report.nulled,
            )
    raw["model"] = model
    result, method = reconcile(rules.values, rules.line_items, rules.confidence, grounded)
    return FieldsOutcome(result, method, model, raw)


def fallback_outcome(segment: Segment, reason: str) -> FieldsOutcome:
    """Used when extraction crashed for one invoice: keep whatever the rules can read."""
    try:
        clean, removed = strip_injection(segment.text)
        rules = _rules(segment, clean)
        result, method = reconcile(rules.values, rules.line_items, rules.confidence, None)
    except Exception:  # last resort: an invoice row must still be written
        result, method, removed = ExtractionResult(), "rules", 0
    raw = {
        "prompt_version": PROMPT_VERSION,
        "llm_status": reason,
        "injection_lines_removed": removed,
        "model": None,
    }
    return FieldsOutcome(result, method, None, raw)
