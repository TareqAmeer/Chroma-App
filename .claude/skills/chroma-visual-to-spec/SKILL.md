---
name: chroma-visual-to-spec
description: Analyze a supplied Chroma UI reference image into the repository's reviewable reference-to-spec JSON draft; never implement or approve production UI.
---

# Chroma visual to spec

Use the canonical repository workflow at `.agents/skills/chroma-visual-to-spec/SKILL.md` and `.agents/skills/chroma-visual-to-spec/references/workflow.md`. Follow its JSON format and commands exactly; the repository reference-to-spec workflow is the source of truth.

This Claude entrypoint adds no alternate procedure. Require an explicit five-hour usage cap, preserve the reference, produce only a validated draft and concise review, and stop before production implementation or approval.
