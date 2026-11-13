' Cria o atalho "Poke Lives" na area de trabalho apontando pra esta pasta.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set l = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\Poke Lives.lnk")
l.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
l.Arguments = """" & dir & "\Abrir Poke Lives.vbs"""
l.WorkingDirectory = dir
l.IconLocation = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\shell32.dll,43")
l.Description = "Abre o Poke Lives"
l.Save
MsgBox "Atalho 'Poke Lives' criado na area de trabalho.", 64, "Poke Lives"

