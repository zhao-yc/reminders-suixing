param(
  [ValidateSet('web', 'publish-web', 'android-resource', 'android', 'harmony-resource', 'devices')]
  [string]$Action = 'web'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskProject = Join-Path $taskRoot 'apps\uni-app'
$taskCli = if ($env:HBX_CLI) { $env:HBX_CLI } elseif (Test-Path -LiteralPath 'D:\HBuilderX\cli.exe') { 'D:\HBuilderX\cli.exe' } else { (Get-Command cli.exe -ErrorAction Stop).Source }

# 固定工程和版本，所有运行由 HBuilderX 界面管理，不启动独立 Vite。
function Invoke-TaskHbx {
  param([string[]]$CliArguments)
  $taskOutput = & $taskCli @CliArguments 2>&1
  $taskExitCode = $LASTEXITCODE
  $taskOutput | Write-Output
  if ($taskExitCode -ne 0) { throw "HBuilderX CLI 执行失败（退出码 $taskExitCode）。" }
  # 某些 CLI 失败仍以 0 退出；不能把官方登录提示当作构建成功。
  if (($taskOutput -join "`n") -match '此功能需要先登录|未检测到已打开的HBuilderX') {
    throw '请先打开 HBuilderX 并自行完成官方登录，再重新执行本命令。'
  }
}
Invoke-TaskHbx -CliArguments @('open')
Invoke-TaskHbx -CliArguments @('version')
Invoke-TaskHbx -CliArguments @('project', 'open', '--path', $taskProject)
switch ($Action) {
  'web' { Invoke-TaskHbx -CliArguments @('launch', 'web', '--project', $taskProject, '--ui', 'true', '--browser', 'Built') }
  'publish-web' {
    $taskBuildStarted = (Get-Date).AddSeconds(-2)
    Invoke-TaskHbx -CliArguments @('publish', 'web', '--project', $taskProject, '--webTitle', '提醒事项·随行')
    $taskIndex = Get-Item -LiteralPath (Join-Path $taskProject 'unpackage/dist/build/web/index.html') -ErrorAction SilentlyContinue
    if (!$taskIndex -or $taskIndex.LastWriteTime -lt $taskBuildStarted) {
      throw '没有取得本次 Web 发布产物；请检查 HBuilderX 编译结果，不使用旧产物冒充构建成功。'
    }
  }
  'android-resource' { Invoke-TaskHbx -CliArguments @('publish', 'app-android', '--project', $taskProject, '--type', 'appResource') }
  'android' { Invoke-TaskHbx -CliArguments @('launch', 'app-android', '--project', $taskProject, '--ui', 'true') }
  'harmony-resource' { Invoke-TaskHbx -CliArguments @('publish', 'app-harmony', '--project', $taskProject, '--type', 'appResource') }
  'devices' { Invoke-TaskHbx -CliArguments @('devices', 'list', '--platform', 'android'); Invoke-TaskHbx -CliArguments @('devices', 'list', '--platform', 'app-harmony') }
}
