# Queue execution and usage plan

User request: complete the Linear queue efficiently, using Luna subagents where useful.

- Keep at most two Luna workers on independently owned tasks. Give them a selected issue, exact file ownership, completion evidence, and a bounded deliverable. Reuse an existing worker for follow-up questions rather than starting another full-history investigation.
- Keep the coordinator responsible for dependencies, review, integration and publication. Serialize the integration checkout and native Cargo/build cache with explicit ownership; overlapping builds waste time and can invalidate evidence.
- Read small issue lists and fetch full descriptions only for selected work. Inspect the relevant code once, retain findings, and send compact context to workers. Avoid repeatedly loading whole files, old thread outputs or unchanged status.
- Share dependency runtimes, browser executables, native build artifacts and large licensed fixtures. Use clean task checkouts without duplicating these caches. Remove only clean, published, unused worktrees after checking unique and ignored files.
- Start with focused verification that proves the changed behavior. Run required wider gates once at the appropriate point; repeat only after relevant changes or a new failure. Record existing gate failures without changing baselines to hide them.
- Resolve native build prerequisites before a long build. Use one aligned disposable app for native Trash verification and RAW measurements, recording its source commit, BUILD and profile. Mocked tests cannot replace native evidence.
- Check account usage after substantial publications or before expensive work. Report the observed percentage rather than promising a fixed number of hours: the five-hour window is an account usage allowance, not five hours of continuous work guaranteed by this plan.
- At an actual usage rejection, preserve task-owned changes and give exact branches, commits, remaining checks and Linear status. Until then, continue authorized work. Tick acceptance criteria only when their evidence is complete and published.

CHR-267 is the current priority. Its remaining native Undo and RAW performance checks share one app build; broader queue work resumes after those dependencies are resolved.
