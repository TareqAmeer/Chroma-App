# Visual-reference-to-spec skills for Chroma

## Recommendation

No reviewed project is a complete fit. The strongest approach is to adapt selected MIT-licensed
parts into Chroma's existing reference-spec workflow rather than install a large skill pack or
copy one skill unchanged.

Use this combination:

1. **Extraction structure:** adapt `visual-to-spec`'s evidence-oriented output and human-review
   boundary.
2. **Measurement and token layering:** adapt `screenshot-to-design-system`'s local colour sampler,
   control-by-control analysis, and primitive → semantic → component token separation.
3. **Process separation:** adapt Design DNA's measure → tokenize → build → verify → record stages.
4. **Verification:** adapt Visual Parity's render → screenshot → compare → fix loop, using Chroma's
   existing Playwright captures rather than its Vite harness.
5. **Governance:** selectively adapt Agentic Design System's outcome, baseline, evidence, typed
   finding, and independent-review contracts. Do not install its ten-skill suite.
6. **Human review:** consider the browser annotation/export mechanics from `frontend-design` only
   after the first reference pilot shows that JSON questions are hard to review.

The Chroma registry, component contracts, `design.md`, reference-spec schema, and approval rules
remain authoritative. Third-party material supplies methods, not design decisions.

## Candidate assessment

| Candidate | Useful parts | Conflicts or gaps | Decision |
| --- | --- | --- | --- |
| [visual-to-spec](https://github.com/xionglingyu51-sys/codex-skills/blob/main/visual-to-spec/SKILL.md) | Visible-evidence analysis, component tree, implementation risks, confidence and human-review files | Treats a finalized screenshot as the visual source of truth; Chroma also requires repository facts, contracts, states and user approval. License was not clearly established in the material reviewed. | Adapt concepts only; do not copy files until license is verified. |
| [screenshot-to-design-system](https://github.com/WCF900905/screenshot-to-design-system) | MIT; cross-agent layout; local Pillow colour sampling; control-region focus; three token layers; source tags; reviewable HTML catalogue | Ignores page layout and icons and fills a generic 24-category library. That would create inferred components outside Chroma's registry. New project with no visible adoption signal in the reviewed page. | Best source for deterministic sampling and token provenance; remove generic component completion. |
| [Design DNA](https://github.com/fasterv410/design-dna) | MIT; separates measuring, tokenizing, building, verifying and recording; reusable token lab; decision record | Claims 1–3px verification without a published Chroma-specific evaluation; assumes a new design system rather than an existing registry. Very new, with one star at review time. | Adapt stage boundaries and decision record; retain Chroma's own tolerances and tests. |
| [visual-parity](https://github.com/Krowli/visual-parity) | MIT; isolated rendering; both themes; concrete visual deltas; safe cleanup | Vite/React harness does not match Chroma's single-file application and existing capture infrastructure. One-commit project at review time. | Adapt the loop, not the harness. |
| [Agentic Design System](https://github.com/aa-on-ai/agentic-design-system) | MIT; strongest governance model; explicit intent, baseline, rubric, rendered evidence, typed findings, responsive/accessibility checks and decision provenance | Ten skills plus MCP and its own evidence formats would duplicate Chroma's mature gates and increase context. It explicitly cannot judge taste without a visual judge or human. | Copy only small contracts/checklists that fill demonstrated gaps. |
| [frontend-design](https://github.com/wenkang-deepblue/frontend-design) | In-browser per-element comments, token choices and exportable implementation prompt; starts from real project components | Primarily a design/review workbench, not a measurement pipeline. License was not clearly established in the reviewed material. | Revisit only if the user-review experience needs a visual annotation interface. |
| [AgentsORG `.design`](https://github.com/AgentsORG/DESIGN) | MIT; portable machine-readable design contract; rationale and component usage rules; imports Google `design.md` | Would introduce a second normative design format beside Chroma's `design.md`, contracts and reference specs. | Do not adopt now; borrow rationale/when-to-use fields if Chroma later demonstrates that gap. |

## Hugging Face and offline tooling

Offline screen parsing can reduce cloud-image tokens, but it should be optional rather than the
core of the first pilot.

| Tool | Capability | Fit for Chroma |
| --- | --- | --- |
| [ScreenParser](https://huggingface.co/docling-project/ScreenParser) | Apache-2.0 detector with boxes, 55 UI classes and confidence | Useful for proposing crops or detecting missed visible controls. It does not extract text or design intent. |
| [ScreenVLM](https://huggingface.co/docling-project/ScreenVLM) | Apache-2.0 compact model producing boxes, semantic tags and visible text | Most relevant later for offline screenshot inventory. It still cannot establish tokens, hidden states or intended behavior. |
| [ShowUI-2B](https://huggingface.co/showlab/ShowUI-2B) | MIT lightweight GUI grounding/action model; an MLX conversion exists for Apple silicon | Designed to locate actionable elements, not create design specifications. Chroma already has stronger source-based component locations. |
| [OmniParser v2](https://huggingface.co/microsoft/OmniParser-v2.0) | General screenshot-to-structured-elements pipeline | Mixed licensing: its detector is AGPL while captioning is MIT. It adds more operational and license complexity than the first pilot warrants. |

Start with Pillow/OpenCV-style pixel measurements already available locally, image crops, Chroma's
source registry and browser geometry. Evaluate ScreenVLM only if manual/reference-model component
segmentation proves expensive across several pilots. Object detection outputs boxes and labels;
they are evidence proposals, not specifications.

## What experienced practitioners consistently report

Practitioner reports are anecdotal, but several patterns recur:

- Generic frontend skills improve compliance more reliably than taste. Project-specific references
  and a durable design system prevent sessions from returning to generic layouts. A detailed
  skill without project evidence can make the same generic output more consistent
  ([discussion](https://www.reddit.com/r/ClaudeAI/comments/1t24gan/few_months_of_frontenddesign_uiuxpromaxskill/)).
- Skills control process; references supply visual direction. A separate design stage, selected
  direction, and later implementation reduce drift and token-heavy iteration
  ([discussion](https://www.reddit.com/r/ClaudeAI/comments/1t3ht2g/claude_code_frontenddesign_skill_always_outputs/)).
- Rendered screenshots and targeted deltas work better than asking for broad repeated polish. The
  implementation must be checked visually after code tests
  ([Hacker News discussion](https://news.ycombinator.com/item?id=47073838)).
- More skills are not automatically better. Practitioners report conflicting aesthetic prompts,
  forgotten decisions and styles returning in long chats; a project-specific system and fresh
  review context matter more than stacking general design skills
  ([discussion](https://www.reddit.com/r/ClaudeAI/comments/1v1v713/any_good_claude_frontenddesign_skills/)).

These accounts are not controlled benchmarks. They support Chroma's current architecture but do
not establish that a particular model or skill is universally best.

## Components to adapt

The eventual Chroma adapter should contain only these additions:

1. **Reference intake:** original file hash, dimensions, provenance, intended scope, views/states,
   and whether copying or broader inspiration is intended.
2. **Deterministic crop manifest:** named pixel rectangles with source coordinates. Never let a
   model silently crop away context.
3. **Measurement records:** value, method, coordinate/sample region, uncertainty, source image and
   scale. Keep sampled colour separate from semantic colour role.
4. **Source classifications:** visible, measured, repository-validated, user-decided, proposed or
   unresolved. Chroma already implements most of this in its reference-spec schema.
5. **Registry binding:** component family plus registry query; never generate an assumed universal
   component library.
6. **Token mapping:** primitive measurement → Chroma semantic role → component token. New values
   remain proposals until approved.
7. **State matrix:** shown, repository-verified, missing or not applicable across theme, width,
   hover, focus, pressed, disabled, changed, error and accessibility modes.
8. **Approval packet:** a visual crop beside a small list of decisions. Approval is explicit and
   cannot be derived from a generated artifact.
9. **Rendered comparison:** baseline and candidate captured with identical viewport/state/theme;
   machine diff reports magnitude and region while a fresh review decides meaning.
10. **Decision record:** preserve accepted direction and supersede it explicitly rather than
    allowing later chats to reinterpret it.

## Components to reject

- Automatic completion of components or states that are absent from the reference.
- Font identification from appearance alone.
- Treating a dominant sampled colour as a semantic token without review.
- Screenshot-to-code in one pass.
- A universal aesthetic skill layered over the Apple-derived Chroma system.
- Full-page image processing on every iteration when a component crop is sufficient.
- Multiple independent schemas for the same design decision.
- Model-generated visual scores as approval.
- Installing large local models before measured token savings justify their maintenance cost.

## Proposed implementation sequence

1. Perform a license and code audit of only `screenshot-to-design-system`'s sampling script and
   schema references, then vendor the smallest useful MIT-licensed parts with attribution.
2. Add Chroma crop/measurement provenance to the existing reference-spec schema rather than adding
   another output format.
3. Create a thin cross-agent skill that routes to the existing Chroma workflow.
4. Test it on one supplied reference for one Color component. Compare its output with a manual
   Astra analysis and record disagreements.
5. Add visual-parity-style candidate comparison using Chroma's existing Playwright capture path.
6. Consider ScreenVLM only after logging the first pilots' time and token use.

This sequence reuses mature ideas while keeping the first test small, reversible and measurable.
It also allows a clear decision after the pilot: retain the adapter, revise it from observed
failures, or replace it.

## Sources

1. WCF900905. [Screenshot to Design System](https://github.com/WCF900905/screenshot-to-design-system). MIT license.
2. fasterv410. [Design DNA](https://github.com/fasterv410/design-dna). MIT license.
3. xionglingyu51-sys. [visual-to-spec](https://github.com/xionglingyu51-sys/codex-skills/blob/main/visual-to-spec/SKILL.md).
4. Krowli. [Visual Parity](https://github.com/Krowli/visual-parity). MIT license.
5. aa-on-ai. [Agentic Design System](https://github.com/aa-on-ai/agentic-design-system). MIT license.
6. AgentsORG. [DESIGN](https://github.com/AgentsORG/DESIGN). MIT license.
7. Google Labs. [design.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md).
8. IBM Research Zurich and ETH Zurich. [ScreenParser](https://huggingface.co/docling-project/ScreenParser) and [ScreenVLM](https://huggingface.co/docling-project/ScreenVLM). Apache-2.0.
9. Show Lab. [ShowUI-2B](https://huggingface.co/showlab/ShowUI-2B). MIT license.
10. Microsoft. [OmniParser v2](https://huggingface.co/microsoft/OmniParser-v2.0). Mixed component licenses.
11. OpenAI. [Current model and image-input guidance](https://developers.openai.com/api/docs/models).
12. Lin et al. [ShowUI: One Vision-Language-Action Model for GUI Visual Agent](https://openaccess.thecvf.com/content/CVPR2025/papers/Lin_ShowUI_One_Vision-Language-Action_Model_for_GUI_Visual_Agent_CVPR_2025_paper.pdf). CVPR 2025.
13. Chen et al. [DCGen: divide-and-conquer screenshot-to-code](https://arxiv.org/abs/2406.16386). 2024.

