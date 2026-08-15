import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export interface LocalFileExport {
  readonly fileName: string
  readonly mimeType: string
  readonly data: string | Blob
  readonly title: string
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function downloadInBrowser(file: LocalFileExport) {
  const blob = typeof file.data === 'string'
    ? new Blob([file.data], { type: file.mimeType })
    : file.data
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** Uses Android's share sheet for reliable local file export from WebView. */
export async function exportLocalFile(file: LocalFileExport): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(file)
    return
  }

  const result = await Filesystem.writeFile({
    path: file.fileName,
    directory: Directory.Cache,
    data: typeof file.data === 'string' ? file.data : await blobToBase64(file.data),
    ...(typeof file.data === 'string' ? { encoding: Encoding.UTF8 } : {}),
  })
  const canShare = await Share.canShare()
  if (!canShare.value) throw new Error('Android share sheet is unavailable')
  await Share.share({
    title: file.title,
    dialogTitle: file.title,
    url: result.uri,
  })
}
