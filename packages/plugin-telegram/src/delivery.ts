import { InputFile } from "grammy";
import type { Bot } from "grammy";
import { getArtifact } from "@personal-ai/core";
import type { Logger, ReportVisual, Storage } from "@personal-ai/core";

interface NamedArtifact {
  id: string;
  name: string;
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

async function sendPhotos(
  bot: Bot,
  chatId: number,
  photos: Array<{ data: Buffer; name: string; caption?: string }>,
): Promise<void> {
  if (photos.length === 0) return;

  if (photos.length === 1 || typeof bot.api.sendMediaGroup !== "function") {
    for (const photo of photos) {
      await bot.api.sendPhoto(chatId, new InputFile(photo.data, photo.name), {
        ...(photo.caption ? { caption: photo.caption } : {}),
      });
    }
    return;
  }

  await bot.api.sendMediaGroup(chatId, photos.map((photo, index) => ({
    type: "photo" as const,
    media: new InputFile(photo.data, photo.name),
    ...(index === 0 && photo.caption ? { caption: photo.caption } : {}),
  })));
}

export async function sendVisualsToTelegram(
  storage: Storage,
  bot: Bot,
  chatId: number,
  visuals: ReportVisual[],
  logger: Logger,
): Promise<void> {
  const photos: Array<{ data: Buffer; name: string; caption?: string }> = [];

  for (const visual of [...visuals].sort((a, b) => a.order - b.order)) {
    try {
      const artifact = getArtifact(storage, visual.artifactId);
      if (!artifact || !isImageMimeType(artifact.mimeType)) continue;
      photos.push({
        data: artifact.data,
        name: artifact.name,
        caption: visual.caption ? `${visual.title} — ${visual.caption}` : visual.title,
      });
    } catch (err) {
      logger.warn("Failed to load visual for Telegram", {
        artifactId: visual.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await sendPhotos(bot, chatId, photos);
}

export async function sendArtifactsToTelegram(
  storage: Storage,
  bot: Bot,
  chatId: number,
  artifacts: NamedArtifact[],
  logger: Logger,
): Promise<void> {
  const photos: Array<{ data: Buffer; name: string; caption?: string }> = [];
  const documents: Array<{ data: Buffer; name: string }> = [];

  for (const artifactRef of artifacts) {
    try {
      const artifact = getArtifact(storage, artifactRef.id);
      if (!artifact) continue;
      if (isImageMimeType(artifact.mimeType)) {
        photos.push({ data: artifact.data, name: artifact.name, caption: artifact.name });
      } else {
        documents.push({ data: artifact.data, name: artifact.name });
      }
    } catch (err) {
      logger.warn("Failed to load Telegram artifact", {
        artifactId: artifactRef.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await sendPhotos(bot, chatId, photos);

  for (const document of documents) {
    await bot.api.sendDocument(chatId, new InputFile(document.data, document.name), {
      caption: document.name,
    });
  }
}
