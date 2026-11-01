param(
    [string]$IdentityName = 'MadMachine.ChromasmithPhotoEditor',
    [string]$Publisher = 'CN=6A889247-A53D-4C8D-AB23-EA74DAEC2E1B',
    [string]$PublisherDisplayName = 'Mad Machine',
    [string]$Version = '1.2.8.0'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $taskRoot 'drafts/microsoft-store/msix-staging'
$output = Join-Path $taskRoot 'drafts/microsoft-store'
if (!(Test-Path (Join-Path $staging 'chromasmith.exe'))) { throw 'Extract and stage the verified installer payload first.' }
$escape = { param($value) [System.Security.SecurityElement]::Escape($value) }
$nameXml = & $escape $IdentityName
$publisherXml = & $escape $Publisher
$displayXml = & $escape $PublisherDisplayName
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="$nameXml" Publisher="$publisherXml" Version="$Version" ProcessorArchitecture="x64" />
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
$sdk = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$sdk) { throw 'Windows SDK MakeAppx.exe was not found.' }
$suffix = if ($IdentityName -eq 'Chromasmith.PackagingPreview' -or $Publisher -eq 'CN=PackagingPreview') { '-PREVIEW-NOT-FOR-STORE' } else { '' }
$package = Join-Path $output "Chromasmith-$Version-x64$suffix.msix"
& $sdk pack /d $staging /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation/packaging failed.' }
Write-Output "Created $package"
if ($suffix) { Write-Warning 'Preview identity only. Supply the exact MSIX Partner Center identity before submission.' }
