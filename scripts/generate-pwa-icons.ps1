Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-EnglishRecallIcon {
  param(
    [int]$Size,
    [bool]$Maskable,
    [string]$OutputPath
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#070a12'))

  $inset = if ($Maskable) { $Size * 0.20 } else { $Size * 0.11 }
  $side = $Size - (2 * $inset)
  $radius = if ($Maskable) { $Size * 0.12 } else { $Size * 0.20 }
  $tile = New-RoundedRectanglePath $inset $inset $side $side $radius
  $purple = [System.Drawing.SolidBrush]::new(
    [System.Drawing.ColorTranslator]::FromHtml('#5b4ee8')
  )
  $graphics.FillPath($purple, $tile)

  $letterInset = if ($Maskable) { $Size * 0.31 } else { $Size * 0.285 }
  $letterTop = if ($Maskable) { $Size * 0.30 } else { $Size * 0.27 }
  $letterWidth = $Size - (2 * $letterInset)
  $stroke = $Size * 0.12
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $graphics.FillRectangle($white, $letterInset, $letterTop, $stroke, $Size * 0.44)
  $graphics.FillRectangle($white, $letterInset, $letterTop, $letterWidth, $stroke)
  $graphics.FillRectangle($white, $letterInset, $letterTop + ($Size * 0.16), $letterWidth * 0.86, $stroke)
  $graphics.FillRectangle($white, $letterInset, $letterTop + ($Size * 0.32), $letterWidth, $stroke)

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $white.Dispose()
  $purple.Dispose()
  $tile.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$publicDirectory = Join-Path $PSScriptRoot '..\public'
New-EnglishRecallIcon 192 $false (Join-Path $publicDirectory 'pwa-icon-192.png')
New-EnglishRecallIcon 512 $false (Join-Path $publicDirectory 'pwa-icon-512.png')
New-EnglishRecallIcon 192 $true (Join-Path $publicDirectory 'pwa-icon-maskable-192.png')
New-EnglishRecallIcon 512 $true (Join-Path $publicDirectory 'pwa-icon-maskable-512.png')
