import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export async function ensurePrivateDirectory(directoryPath, { hardenExisting = true } = {}) {
  if (!directoryPath) throw new Error('directoryPath is required.');
  const createdPath = await mkdir(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (hardenExisting || createdPath) await applyPrivateMode(directoryPath, PRIVATE_DIRECTORY_MODE);
  return directoryPath;
}

export async function writePrivateFile(filePath, data, options = 'utf8') {
  if (!filePath) throw new Error('filePath is required.');
  await ensurePrivateDirectory(path.dirname(filePath), { hardenExisting: false });
  const normalizedOptions = typeof options === 'string'
    ? { encoding: options, mode: PRIVATE_FILE_MODE }
    : { ...options, mode: PRIVATE_FILE_MODE };
  await writeFile(filePath, data, normalizedOptions);
  await applyPrivateMode(filePath, PRIVATE_FILE_MODE);
  return filePath;
}

export async function applyPrivateMode(targetPath, mode) {
  if (process.platform === 'win32') return;
  try {
    await chmod(targetPath, mode);
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
  }
}
