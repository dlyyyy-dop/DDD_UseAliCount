
' DDD数智通 · 内网统计服务 自动启动脚本
' 此脚本放入 Windows 启动文件夹后，开机自动后台运行统计服务
' 不会弹出黑色命令行窗口

Dim objShell
Set objShell = CreateObject("WScript.Shell")

' ⚠️ 请修改下面这行路径，改为 stats_server.py 的实际存放位置
Dim scriptPath
scriptPath = "C:\DDD统计服务\stats_server.py"

' 后台静默启动（0 = 隐藏窗口，False = 不等待完成）
objShell.Run "pythonw.exe """ & scriptPath & """", 0, False

Set objShell = Nothing
