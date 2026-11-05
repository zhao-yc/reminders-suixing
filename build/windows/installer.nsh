; 编码的只读检查由构建脚本从同目录 PowerShell 源文件生成，避免命令行引号歧义。
!macro customCheckAppRunning
  nsExec::ExecToStack /TIMEOUT=8000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${SUIXING_PROCESS_PROBE}'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    ${IfNot} ${Silent}
      ${If} $R0 == 2
        MessageBox MB_OK|MB_ICONEXCLAMATION "请先正常退出“提醒事项·随行”，再运行安装或卸载程序。未保存草稿请先处理。"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "暂时无法确认随行已经退出，请稍后重试。"
      ${EndIf}
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
