param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https?://')]
    [string]$Url,

    [string]$Nombre = 'Confección Central'
)

$publicDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$edgePaths = @(
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
    throw 'No se ha encontrado Microsoft Edge.'
}

$shortcutPath = Join-Path $publicDesktop "$Nombre.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $edge
$shortcut.Arguments = "--app=`"$Url`""
$shortcut.WorkingDirectory = Split-Path $edge
$shortcut.Description = 'Aplicación centralizada de hojas de confección y órdenes de corte'
$shortcut.IconLocation = "$edge,0"
$shortcut.Save()

Write-Host "Acceso creado para todos los usuarios: $shortcutPath"
