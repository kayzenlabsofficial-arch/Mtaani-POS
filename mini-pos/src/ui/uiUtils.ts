export const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

export const emptyProduct = {
  id: '',
  name: '',
  sku: '',
  barcode: '',
  sellingPrice: 0,
  costPrice: 0,
  stockQuantity: 0,
  isActive: 1,
};

export async function resizeLogo(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read logo.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load logo image.'));
    image.src = source;
  });
  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not resize logo.');
  ctx.clearRect(0, 0, size, size);
  const scale = Math.min(size / img.width, size / img.height);
  const width = img.width * scale;
  const height = img.height * scale;
  ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL('image/png', 0.88);
}
