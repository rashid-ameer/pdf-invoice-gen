import bwipjs from "bwip-js";

const CODE128_SAFE = /^[\x20-\x7E]+$/;

export function isBarcodeScannable(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 && trimmed.length <= 80 && CODE128_SAFE.test(trimmed)
  );
}

export function barcodeSourceForLine(input: {
  barcode?: string | null;
}): string | null {
  const barcode = input.barcode?.trim();
  if (barcode && isBarcodeScannable(barcode)) return barcode;
  return null;
}

const barcodeCache = new Map<string, Promise<string | null>>();

export async function generateBarcodeDataUrl(
  text: string,
): Promise<string | null> {
  const value = text.trim();
  if (!isBarcodeScannable(value)) return null;

  let pending = barcodeCache.get(value);
  if (!pending) {
    pending = (async () => {
      try {
        const png = await bwipjs.toBuffer({
          bcid: "code128",
          text: value,
          scale: 3,
          height: 8,
          includetext: true,
          textxalign: "center",
          textsize: 8,
          textgaps: 3,
          barcolor: "111827",
          textcolor: "6B7280",
          backgroundcolor: "FFFFFF",
          paddingwidth: 6,
          paddingheight: 3,
        });
        return `data:image/png;base64,${png.toString("base64")}`;
      } catch {
        return null;
      }
    })();
    barcodeCache.set(value, pending);
  }

  return pending;
}
