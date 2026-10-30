import {BindingScope, injectable} from '@loopback/core';
import {HttpErrors} from '@loopback/rest';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

export const WORKSPACE_AVATAR_SERVICE_BINDING_KEY =
  'services.WorkspaceAvatarService';
export const WORKSPACE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

@injectable({scope: BindingScope.SINGLETON})
export class WorkspaceAvatarService {
  private readonly directory = path.resolve(
    process.env.WORKSPACE_AVATAR_DIR ??
      path.join(__dirname, '../../storage/workspace-avatars'),
  );

  async store(body: Buffer) {
    if (!body.length || body.length > WORKSPACE_AVATAR_MAX_BYTES) {
      throw new HttpErrors.PayloadTooLarge('Choose an image smaller than 5 MB');
    }

    let image: Buffer;

    try {
      const source = sharp(body, {
        limitInputPixels: 16_000_000,
        animated: false,
      });
      const metadata = await source.metadata();

      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
        throw new Error('Unsupported image format');
      }

      image = await source
        .rotate()
        .resize(512, 512, {fit: 'cover', withoutEnlargement: true})
        .webp({quality: 85})
        .toBuffer();
    } catch {
      throw new HttpErrors.UnprocessableEntity(
        'Choose a valid PNG, JPEG or WebP image',
      );
    }

    const filename = `${randomUUID()}.webp`;

    await mkdir(this.directory, {recursive: true});
    await writeFile(this.filePath(filename), image, {flag: 'wx'});

    return filename;
  }

  filePath(filename: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(filename)) {
      throw new HttpErrors.NotFound('Avatar not found');
    }

    return path.join(this.directory, filename);
  }

  async remove(filename: string) {
    await rm(this.filePath(filename), {force: true});
  }
}
