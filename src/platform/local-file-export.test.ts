// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  writeFile: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: mocks.writeFile },
}))
vi.mock('@capacitor/share', () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}))

import { exportLocalFile } from './local-file-export.ts'

describe('exportLocalFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isNativePlatform.mockReturnValue(false)
    mocks.writeFile.mockResolvedValue({ uri: 'file://cache/export.json' })
    mocks.canShare.mockResolvedValue({ value: true })
    mocks.share.mockResolvedValue({})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:web-export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps browser exports on the existing download path', async () => {
    await exportLocalFile({
      fileName: 'backup.json',
      mimeType: 'application/json',
      data: '{"ok":true}',
      title: 'Backup',
    })

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:web-export')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('writes native text exports to cache and opens the Android share sheet', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    await exportLocalFile({
      fileName: 'backup.json',
      mimeType: 'application/json',
      data: '{"ok":true}',
      title: 'Backup',
    })

    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'backup.json',
      directory: 'CACHE',
      data: '{"ok":true}',
      encoding: 'utf8',
    })
    expect(mocks.share).toHaveBeenCalledWith({
      title: 'Backup',
      dialogTitle: 'Backup',
      url: 'file://cache/export.json',
    })
  })

  it('writes binary exports as base64 and reports an unavailable share sheet', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.canShare.mockResolvedValue({ value: false })

    await expect(exportLocalFile({
      fileName: 'template.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: new Blob(['excel']),
      title: 'Template',
    })).rejects.toThrow('Android share sheet is unavailable')

    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'template.xlsx',
      directory: 'CACHE',
      data: 'ZXhjZWw=',
    })
    expect(mocks.share).not.toHaveBeenCalled()
  })
})
