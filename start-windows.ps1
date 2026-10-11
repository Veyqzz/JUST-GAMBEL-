$secure = Read-Host 'Eigenes ADMIN Passwort eingeben (bleibt unsichtbar)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ($env:ADMIN_PASSWORD.Length -lt 8) { Write-Host 'Mindestens 8 Zeichen verwenden!'; exit 1 }
Write-Host 'Website: http://localhost:3000'
node "$PSScriptRoot\server.js"
