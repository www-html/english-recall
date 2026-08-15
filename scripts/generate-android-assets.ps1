Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'public\pwa-icon-maskable-512.png'
$resPath = Join-Path $root 'android\app\src\main\res'
$source = [System.Drawing.Image]::FromFile($sourcePath)

function Write-SquarePng {
  param(
    [string]$Path,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  $launcherSizes = @{
    'mdpi' = 48
    'hdpi' = 72
    'xhdpi' = 96
    'xxhdpi' = 144
    'xxxhdpi' = 192
  }
  $foregroundSizes = @{
    'mdpi' = 108
    'hdpi' = 162
    'xhdpi' = 216
    'xxhdpi' = 324
    'xxxhdpi' = 432
  }

  foreach ($density in $launcherSizes.Keys) {
    $directory = Join-Path $resPath "mipmap-$density"
    Write-SquarePng (Join-Path $directory 'ic_launcher.png') $launcherSizes[$density]
    Write-SquarePng (Join-Path $directory 'ic_launcher_round.png') $launcherSizes[$density]
    Write-SquarePng (Join-Path $directory 'ic_launcher_foreground.png') $foregroundSizes[$density]
  }

  Get-ChildItem -LiteralPath $resPath -Recurse -Filter 'splash.png' | ForEach-Object {
    $existing = [System.Drawing.Image]::FromFile($_.FullName)
    try {
      $width = $existing.Width
      $height = $existing.Height
    } finally {
      $existing.Dispose()
    }

    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::FromArgb(7, 10, 18))
      $iconSize = [int]([Math]::Min($width, $height) * 0.3)
      $x = [int](($width - $iconSize) / 2)
      $y = [int](($height - $iconSize) / 2)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($source, $x, $y, $iconSize, $iconSize)
      $bitmap.Save($_.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

Write-Output 'Android launcher and splash assets generated from existing branding.'
