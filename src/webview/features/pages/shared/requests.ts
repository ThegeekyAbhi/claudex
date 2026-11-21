/** A file as base64, for the host to save. */
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('The image couldn’t be read.'));
    reader.readAsDataURL(file);
  });
}
let requests = 0;
export const nextRequest = () => `r${Date.now().toString(36)}${(requests++).toString(36)}`;
