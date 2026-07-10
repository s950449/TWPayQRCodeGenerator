export function commitRenderedResult(operation, id, metadata) {
  if (!operation.isCurrent(id)) return null;
  return Object.freeze({ ...metadata });
}
