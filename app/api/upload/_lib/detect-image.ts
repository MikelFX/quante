// Magic-byte image detection shared by /api/upload and /api/qads/upload. Server-only.
//
// SECURITY: never trust file.name / file.type (both come from the client's multipart
// header). The extension and Content-Type an upload is stored with are chosen from the
// bytes themselves, so a bucket can't be used to host HTML, SVG-with-script,
// executables, archives, etc. labelled as an image.

export type ImageKind = { ext: string; contentType: string }

export function detectImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return { ext: 'png', contentType: 'image/png' }
  // GIF: "GIF87a" / "GIF89a"
  const head6 = buf.subarray(0, 6).toString('latin1')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return { ext: 'gif', contentType: 'image/gif' }
  // WEBP: "RIFF" <size> "WEBP"
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' }
  }
  // AVIF: <size> "ftyp" "avif" | "avis"
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', contentType: 'image/avif' }
  }
  return null
}
