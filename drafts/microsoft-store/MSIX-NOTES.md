# MSIX packaging status

Source: the installer in Downloads whose SHA-1 is EF611FCACC321E7C9BDD241D374F269DD36508FE, matching the submitted Backblaze installer. Payload extracted with 7-Zip, without running the installer. NSIS plugin/bootstrapper files are excluded. App executable, dist and vendor trees are preserved.

`scripts/package-msix.ps1` builds an unsigned x64 MSIX using Windows SDK MakeAppx with schema validation enabled. Defaults now use the user-supplied Store identity: Name `MadMachine.ChromasmithPhotoEditor`, Publisher `CN=6A889247-A53D-4C8D-AB23-EA74DAEC2E1B`, PublisherDisplayName `Mad Machine`. Store ID: `9N2KCJRFVF6F`; PFN: `MadMachine.ChromasmithPhotoEditor_283hpc665q4m2`.

Known outstanding items:
- Installation and runtime behavior in an MSIX container have not been verified. The preview is unsigned and cannot be installed as-is.
- Adobe callback scheme exceeds the MSIX protocol-name maximum length of 39 characters. No callback protocol is registered in the preview. Lightroom cloud sign-in needs a compatible Adobe redirect configuration and corresponding app changes before shipping that feature.
- WebView2 Evergreen Runtime is a prerequisite. MSIX does not execute the original NSIS bootstrapper.
- Bundled model redistribution terms require review as described in LICENSES-MODELS.md.
- Final package version must match Store version requirements.

Do not delete the existing Partner Center name reservation until the migration and new identity are ready. No listing or reservation was changed by this work.
