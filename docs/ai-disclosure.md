# AI-assisted development disclosure

- **Code:** written by Claude Code (Anthropic's coding agent) under the rules in the repository's
  [`CLAUDE.md`](../CLAUDE.md).
- **Design, prompts and report review:** a Claude chat was used for design discussion, the
  extraction prompt, and review of the evaluation report.
- **Testing and version control:** the developer tested by hand and ran every git command
  personally.
- **In the product:** LedQuill itself calls Groq and Gemini models to extract invoice fields.
  The model order is set by `LLM_MODELS` in `.env.example`.
