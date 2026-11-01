# Worktree cleanup — 2026-10-09

Fetched `origin/main` before auditing. Removed 30 clean worktrees: 17 were at commits that are ancestors of `origin/main`; 13 had only patch-equivalent commits according to `git cherry origin/main <HEAD>`. Dirty, ahead/diverged, primary, and masking-related checkouts were preserved. Git removed registrations and full worktrees for 28 paths. Two additional directories were removed with PowerShell after confirming Git had already deregistered them; their Git metadata was already gone.

## Removed worktrees

- `C:/Users/Tareq/.codex/worktrees/chr270-previous-step/Chroma-App`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a0114af08a75a1a23`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a10d91c276c0d0df3`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a1b7bfac4faad3c13`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a1c65aaaeb5f1c613`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a25fd878659721ccd`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a30aa52bd15bb8a2f`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a456afd49396d5eb0`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a5e5241f8f783895d`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-a9d79fe0e48865c83`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-aa514be97fe909049`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-acecb3ba1ec74892b`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-ad44ef1c995ea6083`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/agent-ad757f237e56b3755`
- `C:/Users/Tareq/Documents/github/Chroma-App/.claude/worktrees/review-codex-photo-editing-9784d6`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr268-prefetch`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr272-reset-integration`
- `C:/Users/Tareq/.codex/worktrees/chr242-sync-decision/Chroma-App`
- `C:/Users/Tareq/.codex/worktrees/chr250-raw-coverage/Chroma-App`
- `C:/Users/Tareq/.codex/worktrees/chr262-film-negative/Chroma-App`
- `C:/Users/Tareq/.codex/worktrees/chr263-model-decision`
- `C:/Users/Tareq/.codex/worktrees/chr269-culling/Chroma-App`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr195-sample-fix`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr199-native-detail-validation`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr201-native-recovery`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr205-user-assets`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr249-reference-kit`
- `C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/photo-ticket-blocker-audit`

## Leftovers and retained paths

The two long-path Android checkout directories initially remained after Git dropped their registrations. After verifying their exact paths were under the repository and unregistered, both directories were fully removed with PowerShell. Their branch refs were preserved.

The Microsoft Store checkout's removal previously returned `Permission denied`. Its path is no longer listed by `git worktree list` and the directory was empty. A nonrecursive PowerShell removal then confirmed the directory is currently in use by another process; the empty directory remains. Its branch ref was preserved.

No disk-reclaimed estimate was collected. No source files or `DEVLOG.md` were changed.

## Bounded follow-up audit — 2026-10-10

Fetched `origin/main` at `99bdefd5bee8d6903790e9e298655112a1d05e3c` and inspected registered checkout status and ancestry. Removed no additional paths: the only clean in-repository checkout already contained in `origin/main` is the dedicated `.worktrees/chr195-integration`, which is the current main integration checkout and is retained. No other candidate was both clearly unused and fully published or patch-equivalent.

### Preserved checkouts and blockers

- Primary checkout `C:/Users/Tareq/Documents/github/Chroma-App` remains dirty with unrelated user/task changes; preserved without modification.
- `.worktrees/chr195-integration` is clean and at the verified current `origin/main` tip; retained as the dedicated integration checkout.
- `.worktrees/chr230-control-sweep` is dirty (`test/control_sweep.mjs`) and was explicitly active during the audit; preserved.
- `.worktrees/android-photo-persistence-integration`, `.worktrees/chr205-native-bundle-validation`, `.worktrees/chr208-native-roundtrip`, `.worktrees/chr244-panorama`, `.worktrees/chr246-inpainting`, `.worktrees/chr262-native-linear`, `.worktrees/chr272-layout-state-completion`, `.worktrees/photo-ticket-completion`, and `.worktrees/windows-native-menu` are dirty; preserved.
- Clean `.worktrees/android-export-methods`, `.worktrees/android-export-performance`, `.worktrees/chr246-inpaint-review`, `.worktrees/chr257-sessions`, `.worktrees/chr268-native-detail`, and `.worktrees/chr275-brush-validation` are not fully published/patch-equivalent to current `origin/main`; preserved rather than discarding ahead commits.
- Registered external checkouts under `C:/Users/Tareq/.codex/worktrees/` and `C:/Users/Tareq/AppData/Local/Temp/claude/` were left alone because they are outside the native repository cleanup scope and are not attached as manageable artifacts to this task. The `.claude/worktrees/` entries were likewise preserved as unrelated workspace/chat work.
- Unregistered `chr245_worktree/` and the primary checkout's other untracked material were not treated as removable worktrees.

No worktree paths were removed in this follow-up; no source files or `DEVLOG.md` were changed. The only edit was this cleanup audit record.
