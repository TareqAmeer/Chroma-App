# Build/install benchmark-only code. Never include this endpoint in a release APK.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $repo
$activity=Join-Path $repo 'android/app/src/main/java/com/tareq/chromasmith/MainActivity.java'
$debug=Join-Path $repo 'android/app/src/debug'
if(Test-Path $debug){throw 'Existing debug sources: preserve them and stage manually.'}
$before=[IO.File]::ReadAllText($activity)
$anchor='registerPlugin(SharedImportPlugin.class);'
if(-not $before.Contains($anchor)){throw 'Registration anchor missing'}
try {
  New-Item -ItemType Directory -Force "$debug/java/com/tareq/chromasmith" | Out-Null
  Copy-Item "$PSScriptRoot/ExportExperimentPlugin.java" "$debug/java/com/tareq/chromasmith/"
  Set-Content "$debug/AndroidManifest.xml" '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="true" /></manifest>'
  [IO.File]::WriteAllText($activity,$before.Replace($anchor,$anchor+' try { registerPlugin((Class) Class.forName("com.tareq.chromasmith.ExportExperimentPlugin")); } catch (ClassNotFoundException ignored) {}'))
  New-Item -ItemType Directory -Force www | Out-Null
  Copy-Item chromasmith-22.html www/index.html
  Copy-Item coi-serviceworker.min.js www/
  Copy-Item vendor www/ -Recurse -Force
  Copy-Item mobile www/ -Recurse -Force
  npx cap sync android
  if($LASTEXITCODE){throw 'Capacitor sync failed'}
  Push-Location android
  try { .\gradlew.bat assembleDebug --no-daemon -q; if($LASTEXITCODE){throw 'Build failed'} } finally {Pop-Location}
  & "$env:ANDROID_HOME/platform-tools/adb.exe" install -r android/app/build/outputs/apk/debug/app-debug.apk
  if($LASTEXITCODE){throw 'Install failed'}
} finally {
  [IO.File]::WriteAllText($activity,$before)
  # This exact directory was absent before staging and was created above.
  $expectedDebug=[IO.Path]::GetFullPath((Join-Path $repo 'android/app/src/debug'))
  if((Resolve-Path $debug).Path -ne $expectedDebug -or -not $expectedDebug.StartsWith($repo+[IO.Path]::DirectorySeparatorChar)){throw 'Unexpected debug path'}
  Remove-Item -LiteralPath $debug -Recurse -Force
}
