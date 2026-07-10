export async function runBatch({
  id,
  rows,
  isCurrent,
  processRow,
  createArchive,
  onProgress,
  onComplete,
  onError,
}) {
  try {
    for (let index = 0; index < rows.length; index += 1) {
      if (!isCurrent(id)) return;
      await processRow(rows[index], index);
      if (!isCurrent(id)) return;
      onProgress(index + 1, rows.length);
    }
    if (!isCurrent(id)) return;
    const archive = await createArchive();
    if (isCurrent(id)) onComplete(archive);
  } catch (error) {
    if (isCurrent(id)) onError(error);
  }
}
