// Sends data from the add-on back to the bridge.
//
// Scripts on a phone cannot open network connections, so replies travel on
// entity tags: the result is JSON -> ASCII -> base64url, cut into chunks, and
// stored as tags named  skyai.<id>.<index>.<total>.<chunk>  on the player
// who is connected to the bridge. The bridge reads them with "/tag @s list"
// and then acknowledges, which removes them.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CHUNK = 180;
export const TAG_PREFIX = "skyai.";

function toAscii(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c < 128 ? text[i] : "\\u" + c.toString(16).padStart(4, "0");
  }
  return out;
}

function base64url(ascii) {
  let out = "";
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i);
    const b = i + 1 < ascii.length ? ascii.charCodeAt(i + 1) : 0;
    const c = i + 2 < ascii.length ? ascii.charCodeAt(i + 2) : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < ascii.length) out += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < ascii.length) out += ALPHABET[c & 63];
  }
  return out;
}

export function clearOutbox(entity, onlyId) {
  const prefix = onlyId === undefined ? TAG_PREFIX : `${TAG_PREFIX}${onlyId}.`;
  for (const tag of entity.getTags()) {
    if (tag.startsWith(prefix)) entity.removeTag(tag);
  }
}

export function sendReply(entity, id, payload) {
  clearOutbox(entity);
  // JSON.stringify keeps non-ASCII characters; escape them so base64 stays simple.
  const encoded = base64url(toAscii(JSON.stringify(payload)));
  const total = Math.max(1, Math.ceil(encoded.length / CHUNK));
  for (let i = 0; i < total; i++) {
    entity.addTag(`${TAG_PREFIX}${id}.${i}.${total}.${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
}
