' Voice Translator Launcher - double-click to start
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the folder this script is in
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill existing server on port 8080
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :8080.*LISTENING') do taskkill /f /pid %a", 0, True

' Start server in hidden window
WshShell.Run "node """ & scriptDir & "\server.js""", 0, False

' Wait for server to start
WScript.Sleep 1500

' Open Edge browser
WshShell.Run "msedge http://localhost:8080", 1, False
