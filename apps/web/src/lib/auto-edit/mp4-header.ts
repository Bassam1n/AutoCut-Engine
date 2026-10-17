/**
 * Length and frame size from an MP4/MOV header (mvhd and the video
 * track's tkhd), for files the browser can't decode, such as HEVC clips
 * from phones on some systems.
 */
export function parseMp4Header(buf: ArrayBuffer): { duration: number; width: number; height: number } | null {
  const v = new DataView(buf);
  let duration = 0;
  let width = 0;
  let height = 0;
  const walk = (start: number, end: number) => {
    let at = start;
    while (at + 8 <= end) {
      let size = v.getUint32(at);
      const type = String.fromCharCode(v.getUint8(at + 4), v.getUint8(at + 5), v.getUint8(at + 6), v.getUint8(at + 7));
      let head = 8;
      if (size === 1 && at + 16 <= end) {
        size = Number(v.getBigUint64(at + 8));
        head = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < head || at + size > end) return;
      const body = at + head;
      if (type === "moov" || type === "trak") walk(body, at + size);
      else if (type === "mvhd") {
        const version = v.getUint8(body);
        const scale = v.getUint32(body + (version === 1 ? 20 : 12));
        const d = version === 1 ? Number(v.getBigUint64(body + 24)) : v.getUint32(body + 16);
        if (scale > 0) duration = d / scale;
      } else if (type === "tkhd" && !width) {
        // Width and height are the last 8 bytes, 16.16 fixed point.
        const w = v.getUint32(at + size - 8) / 65536;
        const h = v.getUint32(at + size - 4) / 65536;
        if (w > 0 && h > 0) {
          width = Math.round(w);
          height = Math.round(h);
        }
      }
      at += size;
    }
  };
  try {
    walk(0, buf.byteLength);
  } catch {
    return null;
  }
  return duration > 0 ? { duration: Math.round(duration * 1000) / 1000, width, height } : null;
}
