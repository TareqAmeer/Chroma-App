<#
Builds the Microsoft Store MSIX from the NSIS installer that desktop-release.yml already produced,
so the Store build is byte-for-byte the same app as the GitHub one.

  pwsh tools/scripts/package-msix.ps1 -Installer Chromasmith-1.2.10-windows-x64-setup.exe -Version 1.2.10 -OutDir out

The payload is pulled out of the installer with 7-Zip (the installer is never run) and the NSIS
plug-in/uninstaller leftovers are dropped. The package is left UNSIGNED: Partner Center re-signs
every submission with the Store certificate, so none is needed for upload.

Identity must match Partner Center > Product identity exactly (a mismatch is rejected on upload).
Store rules: the 4-part version must increase every submission, and the Store reserves the last
part, so it is always 0 (v1.2.10 -> 1.2.10.0).
#>
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Version,
    [string]$OutDir = 'out',
    [string]$IdentityName = 'MadMachine.ChromasmithPhotoEditor',
    [string]$Publisher = 'CN=6A889247-A53D-4C8D-AB23-EA74DAEC2E1B',
    [string]$PublisherDisplayName = 'Mad Machine'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be MAJOR.MINOR.PATCH, got '$Version'" }
$msixVersion = "$Version.0"
$work = Join-Path ([IO.Path]::GetTempPath()) "msix-$([guid]::NewGuid().ToString('N'))"
$staging = Join-Path $work 'staging'
New-Item -ItemType Directory -Force $staging, $OutDir | Out-Null

$sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
if (!$sevenZip) { $sevenZip = 'C:\Program Files\7-Zip\7z.exe' }
if (!(Test-Path $sevenZip)) { throw '7-Zip was not found.' }
& $sevenZip x $Installer "-o$staging" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw '7-Zip could not extract the installer.' }

# NSIS bookkeeping that is not part of the app
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $staging '$PLUGINSDIR'), (Join-Path $staging '$R0'), (Join-Path $staging '[NSIS].nsi'), (Join-Path $staging 'uninstall.exe')
if (!(Test-Path (Join-Path $staging 'chromasmith.exe'))) { throw 'chromasmith.exe is missing from the extracted installer.' }
foreach ($d in 'dist', 'vendor') { if (!(Test-Path (Join-Path $staging $d))) { throw "$d/ is missing from the extracted installer." } }

Copy-Item -Recurse (Join-Path $root 'desktop/src-tauri/msix/Assets') (Join-Path $staging 'Assets')
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $staging 'LICENSE.txt')
Copy-Item (Join-Path $root 'LICENSES-MODELS.md') $staging

$esc = { param($v) [Security.SecurityElement]::Escape($v) }
$nameXml = & $esc $IdentityName; $publisherXml = & $esc $Publisher; $displayXml = & $esc $PublisherDisplayName
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="$nameXml" Publisher="$publisherXml" Version="$msixVersion" ProcessorArchitecture="x64" />
 <Properties><DisplayName>Chromasmith Photo Editor</DisplayName><PublisherDisplayName>$displayXml</PublisherDisplayName><Logo>Assets\StoreLogo.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
 <Resources><Resource Language="en-GB" /></Resources>
 <Applications><Application Id="Chromasmith" Executable="chromasmith.exe" EntryPoint="Windows.FullTrustApplication">
  <uap:VisualElements DisplayName="Chromasmith Photo Editor" Description="RAW Digital. Pure Film." BackgroundColor="#0b0b0a" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
  <Extensions>
   <uap:Extension Category="windows.fileTypeAssociation"><uap:FileTypeAssociation Name="chromasmith.images"><uap:DisplayName>Chromasmith image</uap:DisplayName><uap:SupportedFileTypes><uap:FileType>.jpg</uap:FileType><uap:FileType>.jpeg</uap:FileType><uap:FileType>.png</uap:FileType><uap:FileType>.tif</uap:FileType><uap:FileType>.tiff</uap:FileType><uap:FileType>.rw2</uap:FileType></uap:SupportedFileTypes></uap:FileTypeAssociation></uap:Extension>
  </Extensions>
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
[IO.File]::WriteAllText((Join-Path $staging 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))

$makeappx = (Get-Command makeappx.exe -ErrorAction SilentlyContinue).Source
if (!$makeappx) {
    $makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory |
        Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64\makeappx.exe' } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (!$makeappx) { throw 'Windows SDK MakeAppx.exe was not found.' }

$package = Join-Path (Resolve-Path $OutDir) "Chromasmith-$msixVersion-x64.msix"
& $makeappx pack /d $staging /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation/packaging failed.' }
Remove-Item -Recurse -Force $work
Write-Output "Created $package"
if ($env:GITHUB_OUTPUT) { "msix=$package" | Out-File -Append -Encoding utf8 $env:GITHUB_OUTPUT }
