param(
  [ValidateSet('web', 'publish-web', 'android-resource', 'android', 'harmony-resource', 'devices')]
  [string]$Action = 'web'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskProject = Join-Path $taskRoot 'apps\uni-app'
$taskCli = if ($env:HBX_CLI) { $env:HBX_CLI } elseif (Test-Path -LiteralPath 'D:\HBuilderX\cli.exe') { 'D:\HBuilderX\cli.exe' } else { (Get-Command cli.exe -ErrorAction Stop).Source }

# 固定工程和版本，所有运行由 HBuilderX 界面管理，不启动独立 Vite。
& $taskCli version
& $taskCli project open --path $taskProject
switch ($Action) {
  'web' { & $taskCli launch web --project $taskProject --ui true --browser Built }
  'publish-web' { & $taskCli publish web --project $taskProject --webTitle '提醒事项·随行' }
  'android-resource' { & $taskCli publish app-android --project $taskProject --type appResource }
  'android' { & $taskCli launch app-android --project $taskProject --ui true }
  'harmony-resource' { & $taskCli publish app-harmony --project $taskProject --type appResource }
  'devices' { & $taskCli devices list --platform android; & $taskCli devices list --platform app-harmony }
}
