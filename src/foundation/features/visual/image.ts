import { VISUAL_LIMITS } from "./types";
export function inspectImage(bytes: Uint8Array, mime: string) {
  const b = bytes,
    n = b.length,
    view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (a: number, z: number) => String.fromCharCode(...b.slice(a, z));
  let width = 0,
    height = 0;
  const invalid = () => {
    throw Error("Imagem inválida, truncada ou acima dos limites de dimensões.");
  };
  if (n < 1 || n > 20971520) invalid();
  if (mime === "image/png") {
    if (
      n < 45 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) ||
      ascii(12, 16) !== "IHDR" ||
      view.getUint32(8) !== 13
    )
      invalid();
    width = view.getUint32(16);
    height = view.getUint32(20);
    let pos = 8,
      data = false,
      end = false;
    while (pos + 12 <= n) {
      const size = view.getUint32(pos);
      if (size > n - pos - 12) invalid();
      const type = ascii(pos + 4, pos + 8);
      if (type === "IDAT" && size > 0) data = true;
      if (type === "IEND") {
        end = size === 0 && pos + 12 === n;
        break;
      }
      pos += size + 12;
    }
    if (!data || !end) invalid();
  } else if (mime === "image/webp") {
    if (
      n < 20 ||
      ascii(0, 4) !== "RIFF" ||
      ascii(8, 12) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== n
    )
      invalid();
    let pos = 12,
      frame = false;
    while (pos + 8 <= n) {
      const type = ascii(pos, pos + 4),
        size = view.getUint32(pos + 4, true),
        start = pos + 8;
      if (size > n - start) invalid();
      if (type === "VP8X") {
        if (size < 10 || b[start] & 2) invalid();
        width = 1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16);
        height = 1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16);
      }
      if (type === "VP8 ") {
        if (size < 10 || ascii(start + 3, start + 6) !== "\x9d\x01\x2a")
          invalid();
        const w = view.getUint16(start + 6, true) & 16383,
          h = view.getUint16(start + 8, true) & 16383;
        if (!width) {
          width = w;
          height = h;
        }
        frame = true;
      }
      if (type === "VP8L") {
        if (size < 5 || b[start] !== 47) invalid();
        const bits = view.getUint32(start + 1, true);
        if (!width) {
          width = (bits & 16383) + 1;
          height = ((bits >>> 14) & 16383) + 1;
        }
        frame = true;
      }
      pos = start + size + (size % 2);
    }
    if (!frame || pos !== n) invalid();
  } else if (mime === "image/jpeg") {
    if (
      n < 12 ||
      b[0] !== 255 ||
      b[1] !== 216 ||
      b[n - 2] !== 255 ||
      b[n - 1] !== 217
    )
      invalid();
    let pos = 2,
      scan = false;
    while (pos < n - 2) {
      if (b[pos++] !== 255) invalid();
      while (b[pos] === 255) pos++;
      const marker = b[pos++];
      if (pos + 2 > n) invalid();
      const size = (b[pos] << 8) | b[pos + 1];
      if (size < 2 || pos + size > n) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (size < 8) invalid();
        height = (b[pos + 3] << 8) | b[pos + 4];
        width = (b[pos + 5] << 8) | b[pos + 6];
      }
      if (marker === 218) {
        scan = Boolean(width && height) && pos + size < n - 2;
        break;
      }
      pos += size;
    }
    if (!scan) invalid();
  } else invalid();
  if (
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 65535 ||
    width * height > 40000000
  )
    invalid();
  return { width, height };
}
export async function inspectFile(file: File) {
  if (file.size < 1 || file.size > VISUAL_LIMITS.bytes)
    throw Error("Cada imagem deve ter até 20 MB.");
  return inspectImage(new Uint8Array(await file.arrayBuffer()), file.type);
}
export async function thumbnail(
  file: Blob,
  width: number,
  height: number,
): Promise<Blob> {
  const scale = Math.min(160 / width, 220 / height, 1),
    w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const bitmap = await createImageBitmap(file, {
    resizeWidth: w,
    resizeHeight: h,
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  try {
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  } finally {
    bitmap.close();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(Error("Não foi possível preparar a miniatura.")),
      "image/webp",
      0.8,
    ),
  );
}
