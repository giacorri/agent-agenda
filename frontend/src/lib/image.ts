// Downscale a picked image to a small inline data URL. Config rows are stored in
// SQLite and shipped in the /api/config bundle on every load, so avatars/logos are
// capped hard rather than uploaded to a file endpoint.
export async function downscaleToDataUrl(file: File, maxSide = 128, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = () => no(new Error('bad image')); img.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    // Logos are often transparent PNGs; JPEG would flatten them onto black.
    if (file.type === 'image/png' || file.type === 'image/webp') {
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/png');
    }
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
