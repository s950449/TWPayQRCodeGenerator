export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_BATCH_ROWS = 1000;
export const MAX_FIELD_CODEPOINTS = 128;
export function validateRows(rows) {
  if (rows.length > MAX_BATCH_ROWS) throw new Error(`CSV 資料列數超過上限 ${MAX_BATCH_ROWS}`);
  for (const row of rows) for (const value of Object.values(row)) {
    if ([...String(value ?? "")].length > MAX_FIELD_CODEPOINTS) throw new Error(`CSV 欄位超過 ${MAX_FIELD_CODEPOINTS} 字元`);
  }
  return rows;
}
