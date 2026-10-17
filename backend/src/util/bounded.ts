export function trimTail<T>(items: T[], max: number): void {
  if (items.length > max) items.length = max;
}

export function trimHead<T>(items: T[], max: number): void {
  if (items.length > max) items.splice(0, items.length - max);
}

export function evictOldest<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
