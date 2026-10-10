' Arranca el servidor de actualizaciones sin abrir ninguna ventana de consola
' — así nadie puede cerrarlo sin querer pensando que es una ventana de más.
' Lo usa el acceso directo de la carpeta de Inicio de Windows para que quede
' prendido solo, de forma invisible, mientras esta PC esté encendida.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
proyectoDir = fso.GetParentFolderName(scriptDir)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = proyectoDir
' 0 = ventana oculta, False = no espera a que termine
shell.Run "cmd /c npm run actualizaciones:servir", 0, False
