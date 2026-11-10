// Packs typed arrays (the map grids) into text so a saved world fits in JSON.

// Typed array -> base64 string.
export function pack(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Base64 string -> fills `target`, which must be the same type and length as the packed array.
export function unpack(text, target) {
  const binary = atob(text);
  const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
  if (binary.length !== bytes.length) throw new Error('Saved map is the wrong size for this version');
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
}
