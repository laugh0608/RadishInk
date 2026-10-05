import { ImageHostManager, type ImageHostConfig } from "./ImageUploader";
import {
  getStoredImageHostConfig,
  IMAGE_UPLOAD_DISABLED_MESSAGE,
} from "./imageHostConfig";
export { getStoredImageHostConfig } from "./imageHostConfig";
import {
  type ImageCompressionDependencies,
  type PrepareImageForUploadOptions,
  prepareImageForUpload,
} from "./autoCompressImage";

export interface UploadEditorImageOptions {
  compressionOptions?: PrepareImageForUploadOptions;
  compressionDependencies?: ImageCompressionDependencies;
  getImageHostConfig?: () => ImageHostConfig;
  createManager?: (config: ImageHostConfig) => {
    upload: (file: File) => Promise<string>;
  };
}

export interface UploadEditorImageResult {
  url: string;
  sourceFile: File;
  uploadedFile: File;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
}

export async function uploadEditorImage(
  sourceFile: File,
  options: UploadEditorImageOptions = {},
): Promise<UploadEditorImageResult> {
  const config = options.getImageHostConfig
    ? options.getImageHostConfig()
    : getStoredImageHostConfig();
  if (config.type === "none") throw new Error(IMAGE_UPLOAD_DISABLED_MESSAGE);

  const prepared = await prepareImageForUpload(
    sourceFile,
    options.compressionOptions,
    options.compressionDependencies,
  );

  const manager = options.createManager
    ? options.createManager(config)
    : new ImageHostManager(config);
  const url = await manager.upload(prepared.file);

  return {
    url,
    sourceFile,
    uploadedFile: prepared.file,
    compressed: prepared.compressed,
    originalSize: prepared.originalSize,
    finalSize: prepared.finalSize,
  };
}
