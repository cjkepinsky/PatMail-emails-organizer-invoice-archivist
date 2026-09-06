import { randomUUID } from "node:crypto";

export const MAX_INLINE_IMAGE_COUNT = 6;
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_MESSAGE_FILES_TOTAL_BYTES = 20 * 1024 * 1024;

export type InlineImageInput = {
  filename: string;
  mimeType: string;
  data: string;
};

export type AttachmentInput = InlineImageInput;

type NormalizedInlineImage = {
  filename: string;
  mimeType: string;
  content: Buffer;
  contentId: string;
};

type NormalizedAttachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

type MimeEntity = {
  headers: string[];
  body: string;
};

export function buildMessageContent(
  body: string,
  imageInputs: InlineImageInput[] = [],
  attachmentInputs: AttachmentInput[] = []
) {
  const images = normalizeInlineImages(imageInputs);
  const attachments = normalizeAttachments(attachmentInputs);
  const totalBytes = [...images, ...attachments].reduce((total, file) => total + file.content.length, 0);
  if (totalBytes > MAX_MESSAGE_FILES_TOTAL_BYTES) {
    throw new Error(
      `Obrazy i załączniki mogą mieć łącznie maksymalnie ${formatMegabytes(MAX_MESSAGE_FILES_TOTAL_BYTES)} MB.`
    );
  }

  const content = buildRenderableContent(body, images);
  if (attachments.length === 0) {
    return {
      ...content,
      imageCount: images.length,
      attachmentCount: 0
    };
  }

  const mixedBoundary = `patmail-mixed-${randomUUID()}`;
  const parts = [`--${mixedBoundary}`, ...content.headers, "", content.body];

  for (const attachment of attachments) {
    const fallbackFilename = asciiFilename(attachment.filename, "attachment");
    const encodedFilename = encodeRfc5987(attachment.filename);
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${fallbackFilename}"; name*=UTF-8''${encodedFilename}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      "",
      encodeMimeBase64(attachment.content)
    );
  }
  parts.push(`--${mixedBoundary}--`, "");

  return {
    headers: [`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`],
    body: normalizeCrlf(parts.join("\r\n")),
    imageCount: images.length,
    attachmentCount: attachments.length
  };
}

function buildRenderableContent(body: string, images: NormalizedInlineImage[]): MimeEntity {
  if (images.length === 0) {
    return {
      headers: [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit"
      ],
      body: `${normalizeCrlf(body)}\r\n`
    };
  }

  const relatedBoundary = `patmail-related-${randomUUID()}`;
  const alternativeBoundary = `patmail-alternative-${randomUUID()}`;
  const plainText = [body.trim(), ...images.map(image => `[Inline image: ${image.filename}]`)]
    .filter(Boolean)
    .join("\n\n");
  const htmlText = body.trim()
    ? `<div>${escapeHtml(body.trim()).replace(/\r?\n/g, "<br>\r\n")}</div>`
    : "";
  const htmlImages = images
    .map(
      image =>
        `<div style="margin-top:12px"><img src="cid:${escapeHtmlAttribute(image.contentId)}" alt="${escapeHtmlAttribute(image.filename)}" style="max-width:100%;height:auto"></div>`
    )
    .join("\r\n");
  const html = `<!doctype html><html><body>${htmlText}${htmlImages}</body></html>`;

  const parts = [
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBase64(Buffer.from(plainText, "utf8")),
    `--${alternativeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBase64(Buffer.from(html, "utf8")),
    `--${alternativeBoundary}--`
  ];

  for (const image of images) {
    const fallbackFilename = asciiFilename(image.filename);
    const encodedFilename = encodeRfc5987(image.filename);
    parts.push(
      `--${relatedBoundary}`,
      `Content-Type: ${image.mimeType}; name="${fallbackFilename}"; name*=UTF-8''${encodedFilename}`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${image.contentId}>`,
      `X-Attachment-Id: ${image.contentId}`,
      `Content-Disposition: inline; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      "",
      encodeMimeBase64(image.content)
    );
  }
  parts.push(`--${relatedBoundary}--`, "");

  return {
    headers: [`Content-Type: multipart/related; boundary="${relatedBoundary}"`],
    body: normalizeCrlf(parts.join("\r\n"))
  };
}

export function normalizeInlineImages(inputs: InlineImageInput[]) {
  if (!Array.isArray(inputs)) return [];
  if (inputs.length > MAX_INLINE_IMAGE_COUNT) {
    throw new Error(`Można wkleić maksymalnie ${MAX_INLINE_IMAGE_COUNT} obrazów do jednej wiadomości.`);
  }

  let totalBytes = 0;
  return inputs.map((input, index): NormalizedInlineImage => {
    const mimeType = String(input?.mimeType || "").trim().toLowerCase();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(mimeType)) {
      throw new Error("Obsługiwane są obrazy PNG, JPEG, GIF i WebP.");
    }

    const data = String(input?.data || "").replace(/\s+/g, "");
    if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
      throw new Error("Wklejony obraz zawiera nieprawidłowe dane.");
    }
    const content = Buffer.from(data, "base64");
    if (content.length === 0 || content.length > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(`Pojedynczy obraz może mieć maksymalnie ${formatMegabytes(MAX_INLINE_IMAGE_BYTES)} MB.`);
    }
    totalBytes += content.length;
    if (totalBytes > MAX_MESSAGE_FILES_TOTAL_BYTES) {
      throw new Error(`Wklejone obrazy mogą mieć łącznie maksymalnie ${formatMegabytes(MAX_MESSAGE_FILES_TOTAL_BYTES)} MB.`);
    }

    return {
      filename: normalizeImageFilename(input.filename, mimeType, index),
      mimeType,
      content,
      contentId: `patmail-image-${randomUUID()}@local.patmail`
    };
  });
}

export function normalizeAttachments(inputs: AttachmentInput[]) {
  if (!Array.isArray(inputs)) return [];
  if (inputs.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Można dodać maksymalnie ${MAX_ATTACHMENT_COUNT} załączników do jednej wiadomości.`);
  }

  let totalBytes = 0;
  return inputs.map((input, index): NormalizedAttachment => {
    const content = decodeBase64(input?.data, "Załącznik zawiera nieprawidłowe dane.");
    if (content.length === 0 || content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Pojedynczy załącznik może mieć maksymalnie ${formatMegabytes(MAX_ATTACHMENT_BYTES)} MB.`);
    }
    totalBytes += content.length;
    if (totalBytes > MAX_MESSAGE_FILES_TOTAL_BYTES) {
      throw new Error(`Załączniki mogą mieć łącznie maksymalnie ${formatMegabytes(MAX_MESSAGE_FILES_TOTAL_BYTES)} MB.`);
    }

    return {
      filename: normalizeFilename(input?.filename, `attachment-${index + 1}`),
      mimeType: normalizeMimeType(input?.mimeType),
      content
    };
  });
}

function normalizeImageFilename(value: string, mimeType: string, index: number) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return normalizeFilename(value, `pasted-image-${index + 1}.${extension}`);
}

function normalizeFilename(value: string, fallback: string) {
  const clean = String(value || "")
    .replace(/[\r\n\\/]+/g, "-")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

function normalizeMimeType(value: string) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(clean)
    ? clean
    : "application/octet-stream";
}

function decodeBase64(value: string, errorMessage: string) {
  const data = String(value || "").replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error(errorMessage);
  }
  return Buffer.from(data, "base64");
}

function encodeMimeBase64(buffer: Buffer) {
  return buffer.toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function asciiFilename(value: string, fallback = "pasted-image") {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\;]/g, "-")
    .trim();
  return (ascii || fallback).slice(0, 120);
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function normalizeCrlf(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}

function formatMegabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024));
}
