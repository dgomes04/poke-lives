' Abre o Poke Lives sem janela de terminal.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FileExists(dir & "\node_modules\.bin\electron.cmd") Then
  MsgBox "Primeira vez: vou instalar o que falta (leva 1 minuto).", 64, "Poke Lives"
  sh.Run "cmd /c npm install", 1, True
End If
sh.Run "cmd /c """ & dir & "\node_modules\.bin\electron.cmd"" .", 0, False
