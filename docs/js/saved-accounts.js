import { validateTransfer } from "./twqrp.js";

export function requireConsent(consented) {
  if (!consented) throw new Error("請先同意在此裝置儲存完整帳號");
}

export function createAccountRecord({ id = crypto.randomUUID(), label, bankId, account }) {
  const v = validateTransfer({ bankId, account, amount: null, memo: "" });
  return Object.freeze({ id, label: String(label).trim(), bankId: v.bankId, account: v.account, createdAt: Date.now() });
}

export function normalizeLegacyAccounts(records) {
  if (!Array.isArray(records)) throw new Error("舊帳號資料格式錯誤");
  return records.map((x) => createAccountRecord({ label: x.label, bankId: x.bankId, account: x.account }));
}

const DB_NAME = "twpay_saved_accounts_v2";
const LEGACY_KEY = "twpay_saved_accounts";

export class SavedAccountStore {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
    this.dbPromise = null;
    this.channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DB_NAME) : null;
  }
  _db() {
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore("accounts", { keyPath: "id" }); db.createObjectStore("settings", { keyPath: "key" }); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
  async _tx(mode, work) { const db = await this._db(); return new Promise((resolve, reject) => { const tx = db.transaction(["accounts", "settings"], mode); let result; tx.oncomplete = () => { if (mode === "readwrite" && this.channel) this.channel.postMessage("changed"); Promise.resolve(result).then(resolve, reject); }; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("交易中止")); try { result = work(tx.objectStore("accounts"), tx.objectStore("settings")); } catch (e) { reject(e); } }); }
  async hasConsent() { return this._tx("readonly", (_a, s) => new Promise((resolve, reject) => { const r = s.get("consent"); r.onsuccess = () => resolve(Boolean(r.result?.value)); r.onerror = () => reject(r.error); })); }
  async setConsent() { return this._tx("readwrite", (_a, s) => s.put({ key: "consent", value: true })); }
  async list() { return this._tx("readonly", (a) => new Promise((resolve, reject) => { const r = a.getAll(); r.onsuccess = () => resolve(r.result.sort((x, y) => x.createdAt - y.createdAt)); r.onerror = () => reject(r.error); })); }
  async add(input) { requireConsent(await this.hasConsent()); const record = createAccountRecord(input); await this._tx("readwrite", (a) => a.put(record)); return record; }
  async remove(id) { await this._tx("readwrite", (a) => a.delete(id)); }
  async clear() { await this._tx("readwrite", (a) => a.clear()); this.clearLegacy(); }
  hasLegacy() { return Boolean(this.storage?.getItem(LEGACY_KEY)); }
  clearLegacy() { this.storage?.removeItem(LEGACY_KEY); }
  async migrateLegacy() { requireConsent(await this.hasConsent()); const raw = this.storage?.getItem(LEGACY_KEY); if (!raw) return []; let records; try { records = normalizeLegacyAccounts(JSON.parse(raw)); } catch (e) { throw new Error("舊帳號資料無法匯入", { cause: e }); } await this._tx("readwrite", (a) => { records.forEach((r) => a.put(r)); }); this.clearLegacy(); return records; }
  subscribe(listener) { if (!this.channel) return () => {}; const fn = (e) => { if (e.data === "changed") listener(); }; this.channel.addEventListener("message", fn); return () => this.channel.removeEventListener("message", fn); }
  close() { this.channel?.close(); }
}
