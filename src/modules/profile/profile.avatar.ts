import sharp from 'sharp';
import { HttpError } from '../../shared/http-error.js';

export async function normalizeAvatar(bytes: Buffer): Promise<Buffer> {
  try {
    if (!bytes.length || bytes.length > 1000000) throw new Error('size');
    const image = sharp(bytes, {
      limitInputPixels: 4096 * 4096,
      failOn: 'warning',
      animated: false,
    });
    const meta = await image.metadata();
    if (
      !meta.format ||
      !['jpeg', 'png', 'webp'].includes(meta.format) ||
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages ?? 1) > 1
    )
      throw new Error('format');
    // Sharp drops metadata by default. Re-encode after full decoding; never serve original uploads.
    const output = await image
      .rotate()
      .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (output.length > 1000000) throw new Error('size');
    return output;
  } catch {
    throw new HttpError(
      400,
      'AVATAR_INVALID',
      'Choose a valid, single-frame JPG, PNG or WebP up to 1 MB and 4096 pixels per side.',
    );
  }
}
