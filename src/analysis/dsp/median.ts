/**
 * Sliding-window median over `n` values read with a stride, written to `dst` with the same stride.
 * Keeps a sorted window and updates it incrementally (O(win) per sample). Values past either end
 * repeat the end value. Only the first `count` medians are written; the window still reads past them.
 */
export function medianFilter(
  src: Float32Array,
  dst: Float32Array,
  offset: number,
  stride: number,
  n: number,
  win: number,
  sorted: Float32Array,
  count = n,
) {
  const half = win >> 1;
  const last = n - 1;
  let len = 0;
  for (let i = -half; i <= half; i++) {
    const v = src[offset + (i < 0 ? 0 : i > last ? last : i) * stride];
    let j = len++;
    while (j > 0 && sorted[j - 1] > v) {
      sorted[j] = sorted[j - 1];
      j--;
    }
    sorted[j] = v;
  }
  for (let i = 0; i < count; i++) {
    dst[offset + i * stride] = sorted[half];
    // Out goes the oldest value (found by binary search), in comes the next one (by insertion).
    const leave = i - half;
    const old = src[offset + (leave < 0 ? 0 : leave > last ? last : leave) * stride];
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < old) lo = mid + 1;
      else hi = mid;
    }
    const enter = i + half + 1;
    const v = src[offset + (enter < 0 ? 0 : enter > last ? last : enter) * stride];
    // Removing at `lo` and inserting `v` in one pass: shift only the stretch between the two places.
    let j = lo;
    if (j + 1 < len && sorted[j + 1] < v) {
      while (j + 1 < len && sorted[j + 1] < v) {
        sorted[j] = sorted[j + 1];
        j++;
      }
    } else {
      while (j > 0 && sorted[j - 1] > v) {
        sorted[j] = sorted[j - 1];
        j--;
      }
    }
    sorted[j] = v;
  }
}
