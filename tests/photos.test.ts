import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { photoExtension, preparePhoto } from '../src/lib/photos'

const { heicTo } = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to/csp', () => ({ heicTo }))
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const heic = new Uint8Array([
  0,
  0,
  0,
  24,
  ...new TextEncoder().encode('ftypheic'),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode('mif1heic'),
])
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> }
let canvas: {
  width: number
  height: number
  getContext: ReturnType<typeof vi.fn>
  toBlob: ReturnType<typeof vi.fn>
}
let draw: ReturnType<typeof vi.fn>
let nativeImageWorks = false
beforeEach(() => {
  nativeImageWorks = false
  heicTo.mockReset()
  bitmap = { width: 4032, height: 3024, close: vi.fn() }
  draw = vi.fn()
  canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: draw, fillRect: vi.fn() })),
    toBlob: vi.fn((cb: BlobCallback, mime: string) => cb(new Blob(['encoded'], { type: mime }))),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 3000
      naturalHeight = 4000
      onload = () => {}
      onerror = () => {}
      set src(_value: string) {
        queueMicrotask(() => (nativeImageWorks ? this.onload() : this.onerror()))
      }
      removeAttribute() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('phone photos', () => {
  it('decodes by header despite missing or incorrect MIME and resizes without stretching', async () => {
    const result = await preparePhoto(new File([jpeg], 'IMG_1234', { type: '' }))
    expect(result.type).toBe('image/webp')
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 1200, 900)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(1)
    expect(heicTo).not.toHaveBeenCalled()
  })
  it('uses Safari native HEIC support without downloading the converter', async () => {
    await preparePhoto(new File([heic], 'photo.HEIC', { type: 'application/octet-stream' }))
    expect(vi.mocked(createImageBitmap).mock.calls[0][0]).toMatchObject({ type: 'image/heic' })
    expect(heicTo).not.toHaveBeenCalled()
  })
  it('falls back to an image element if Safari bitmap decoding fails', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('not supported'))
    nativeImageWorks = true
    await preparePhoto(new File([heic], 'photo.HEIF'))
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 900, 1200])
    expect(heicTo).not.toHaveBeenCalled()
  })
  it('converts HEIC locally when both native decoding paths fail', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('HEIC not supported'))
    heicTo.mockResolvedValue(bitmap)
    const result = await preparePhoto(new File([heic], 'IMG_1.HEIC'))
    expect(heicTo).toHaveBeenCalledWith({ blob: expect.any(Blob), type: 'bitmap' })
    expect(result.type).toBe('image/webp')
    expect(bitmap.close).toHaveBeenCalledOnce()
  })
  it('handles browsers without createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    nativeImageWorks = true
    await expect(preparePhoto(new File([jpeg], 'photo.jpg'))).resolves.toBeInstanceOf(Blob)
  })
  it('returns correctly labeled JPEG when WebP encoding is unavailable', async () => {
    canvas.toBlob.mockImplementation((cb: BlobCallback, mime: string) =>
      cb(new Blob(['encoded'], { type: mime === 'image/webp' ? 'image/png' : mime })),
    )
    const result = await preparePhoto(new File([png], 'photo.png'))
    expect(result.type).toBe('image/jpeg')
    expect(photoExtension(result)).toBe('jpg')
  })
  it('rejects oversized, unsupported and corrupt files with actionable errors', async () => {
    await expect(
      preparePhoto(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'huge.heic')),
    ).rejects.toThrow('photoTooLarge')
    await expect(
      preparePhoto(new File(['not an image'], 'fake.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('invalidPhoto')
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('decode'))
    heicTo.mockRejectedValue(new Error('corrupt HEIC'))
    await expect(preparePhoto(new File([heic], 'broken.heic'))).rejects.toThrow('photoUnreadable')
  })
  it('releases the decoded image when encoding fails', async () => {
    canvas.toBlob.mockImplementation((cb: BlobCallback) => cb(null))
    await expect(preparePhoto(new File([jpeg], 'photo.jpg'))).rejects.toThrow('photoUnreadable')
    expect(bitmap.close).toHaveBeenCalledOnce()
  })
  it('recompresses output to fit the storage limit and rejects unsupported output types', async () => {
    canvas.toBlob.mockImplementationOnce((cb: BlobCallback) =>
      cb(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' })),
    )
    expect((await preparePhoto(new File([jpeg], 'photo.jpg'))).size).toBeLessThan(2 * 1024 * 1024)
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/webp', 0.65)
    expect(() => photoExtension(new Blob(['x'], { type: 'image/heic' }))).toThrow('invalidPhoto')
  })
})
