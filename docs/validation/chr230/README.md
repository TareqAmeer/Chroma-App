# CHR-230 exhaustive control sweep evidence

The four JSON files in this directory are the complete, independently preserved reports for the final frozen candidate `248ca47efc838b35f05de38730e759c93d316ae6`. Each traversal exhausted its queue at depth 2 using the real-app `?libtest=1` fixture, with the shared Playwright/Chromium runtime and explicit native desktop mocks used by the harness. No acceptance baseline was updated.

The command for each run was `node test/control_sweep.mjs --surface=<library|editor> --depth=2`, with `CHROMASMITH_SHARED_MODULE_ROOT`, `NODE_OPTIONS=--loader=file:///C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/_shared-test-runtime/deps-loader.mjs`, and `CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe` set as in the task runtime. The source commit and invocation configuration were identical within each pair.

| Surface | Run | Found | Changed | Inert | Unreach | Errors | Full gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Library | 1 | 183 | 173 | 4 | 2 | 0 | Exit 1: 3 unaccepted inert outcomes |
| Library | 2 | 183 | 172 | 5 | 2 | 0 | Exit 1: 3 unaccepted inert outcomes |
| Editor | 1 | 193 | 189 | 1 | 0 | 0 | Exit 1: 1 unaccepted inert outcome |
| Editor | 2 | 193 | 190 | 1 | 0 | 0 | Exit 1: 1 unaccepted inert outcome |

Each complete pair meets CHR-230's reachability criterion (fewer than five unreach per surface in two consecutive identical runs). The nonzero full-gate results are retained honestly: Library still reports Rotate right, Flip horizontal, and the unnamed History range as inert in the empty-photo fixture; Editor reports `#btn-before` as inert. No controls were suppressed and no inert entries were accepted to obtain the reachability result. The manual lens input is available only in the explicit desktop mock fixture; these sweeps do not establish native platform coverage.

SHA256:
- `library-run-1.json`: `82D50B7BF195CB33D768B04A7510E742544D4D8CE75C529DEAF6582F475546A5`
- `library-run-2.json`: `209E9F1AC48F407627AC80C384953DF744B0495F863B03477A62209527FBFDDB`
- `editor-run-1.json`: `47630B2BAF2B84A83E4E4130A4DD9434B1F2AAFE3815DE66EEA75BAC0DFB1750`
- `editor-run-2.json`: `3A6285C2F8D436799031E65B3F22B8A07699A1117A92C10D21C63C4279C67E14`
