# Prompts

The extraction prompt lives in code, not here, so there is one source of truth:

- File: [`backend/app/llm/prompts.py`](../backend/app/llm/prompts.py)
- Version constant: `PROMPT_VERSION` (currently `extract-v1`)
- Contents: `SYSTEM_PROMPT` (extraction rules, untrusted-text rule, JSON-only output),
  `OUTPUT_SCHEMA` (the JSON shape the model must return), `REPAIR_SUFFIX` (appended on a retry
  after invalid JSON), and the message builder that wraps the document text in a delimited block.

Design background for the prompt is in [design.md](design.md), section 4.
