---
name: chroma-visual-to-spec
description: Analyze a supplied Chroma UI reference image into a measurable, reviewable reference-to-spec JSON draft; use for screenshot-to-spec and reference-image analysis, never production UI implementation.
---

# Chroma visual to spec

Create a draft-only, vendor-neutral specification from one bounded component family or screen reference. Require the prompt to state an explicit five-hour usage cap; check usage before work and before optional work. Preserve the supplied reference unchanged and do not use image generation.

Read the canonical repository workflow before analysis: [workflow](references/workflow.md). It defines the required evidence separation, repository queries, JSON output, review, validation, and stop conditions. The repository reference-to-spec workflow is authoritative.

Work in the order measure → specify → approve → implement → verify → record. This skill covers only measure and specify: approval, implementation, and verification need separate authorization. Do not implement production UI, redesign the reference, create a Color specification, edit contracts or baselines, or approve a design. Recommend separate chats for analysis, approval recording, implementation, and independent review.
