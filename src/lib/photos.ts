// The picker includes extensions because iOS/Files may omit or vary MIME types.
export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.jpg,.jpeg,.png,.webp,.heic,.heif'
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const MAX_EDGE = 1200

type DecodedPhoto = {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

// Inspect only the header; filenames and MIME types are unreliable on phones.
async function photoType(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer())
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  if (text(4, 8) === 'ftyp') {
    const boxSize = new DataView(bytes.buffer).getUint32(0)
    for (let offset = 8; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (offset === 12) continue // minor version, not a compatible brand
      if (
        ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(
          text(offset, offset + 4),
        )
      )
        return 'image/heic'
    }
  }
  throw new Error('invalidPhoto')
}

function decodedBitmap(bitmap: ImageBitmap): DecodedPhoto {
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
}

async function decodeNative(blob: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      return decodedBitmap(await createImageBitmap(blob))
    } catch {
      // Some Safari versions can display a photo but cannot create its bitmap.
    }
  }
  const url = URL.createObjectURL(blob)
  const img = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('photoUnreadable'))
      img.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => img.removeAttribute('src'),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function decodePhoto(blob: Blob): Promise<DecodedPhoto> {
  try {
    return await decodeNative(blob)
  } catch {
    if (blob.type !== 'image/heic') throw new Error('photoUnreadable')
  }
  try {
    // Only download the decoder when the browser cannot read HEIC itself.
    // It runs locally in a worker; the original photo never leaves the device.
    const { heicTo } = await import('heic-to/csp')
    if (typeof createImageBitmap === 'function')
      return decodedBitmap(await heicTo({ blob, type: 'bitmap' }))
    return await decodeNative(await heicTo({ blob, type: 'image/jpeg', quality: 0.92 }))
  } catch {
    throw new Error('photoUnreadable')
  }
}

export function photoExtension(blob: Blob): string {
  const extension = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type]
  if (!extension) throw new Error('invalidPhoto')
  return extension
}

export async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('photoTooLarge')
  const type = await photoType(file)
  const decoded = await decodePhoto(file.slice(0, file.size, type))
  const canvas = document.createElement('canvas')
  try {
    if (!decoded.width || !decoded.height) throw new Error('photoUnreadable')
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('photoUnreadable')
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    const encode = (mime: string, quality: number) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('photoUnreadable'))),
          mime,
          quality,
        ),
      )
    let blob = await encode('image/webp', 0.84)
    if (blob.type !== 'image/webp') {
      // Safari may return PNG when WebP encoding is unavailable. Use JPEG and
      // flatten transparency onto white rather than uploading mislabeled data.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      blob = await encode('image/jpeg', 0.84)
    }
    if (blob.size > MAX_UPLOAD_BYTES) blob = await encode(blob.type, 0.65)
    photoExtension(blob)
    if (!blob.size || blob.size > MAX_UPLOAD_BYTES) throw new Error('photoUnreadable')
    return blob
  } catch {
    throw new Error('photoUnreadable')
  } finally {
    decoded.close()
    canvas.width = canvas.height = 1
  }
}
