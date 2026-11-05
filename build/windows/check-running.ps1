# 安装及卸载只查询固定程序名，不读取命令行、窗口内容或会话，不关闭进程。
$ErrorActionPreference='Stop'
try {
  $taskRunning=@(Get-CimInstance Win32_Process -Filter "Name='提醒事项随行.exe'")
  if($taskRunning.Count -gt 0){exit 2}
  exit 0
} catch {exit 3}
