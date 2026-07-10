import { validateTransfer } from "./twqrp.js";

export function requireConsent(consented) {
  if (!consented) throw new Error("請先同意在此裝置儲存完整帳號");
}

export function createAccountRecord({ id = crypto.randomUUID(), label, bankId, account }) {
  return Object.freeze({ id, label: String(label).trim(), bankId: String(bankId), account: String(account), createdAt: Date.now() });
}

const DB_NAME = "twpay_saved_accounts_v2";
const LEGACY_KEY = "twpay_saved_accounts";

export class SavedAccountStore {
  constructor() {
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
  async _tx(mode, work) { const db = await this._db(); return new Promise((resolve, reject) => { const tx = db.transaction(["accounts", "settings"], mode); let result; tx.oncomplete = () => { if (mode === "readwrite" && this.channel) this.channel.postMessage("changed"); resolve(result); }; tx.onerror = () => reject(tx.error); result = work(tx.objectStore("accounts"), tx.objectStore("settings")); }); }
  async hasConsent() { return this._tx("readonly", (_a, s) => new Promise((resolve, reject) => { const r = s.get("consent"); r.onsuccess = () => resolve(Boolean(r.result?.value)); r.onerror = () => reject(r.error); })); }
  async setConsent() { return this._tx("readwrite", (_a, s) => s.put({ key: "consent", value: true })); }
  async list() { return this._tx("readonly", (a) => new Promise((resolve, reject) => { const r = a.getAll(); r.onsuccess = () => resolve(r.result.sort((x, y) => x.createdAt - y.createdAt)); r.onerror = () => reject(r.error); })); }
  async add(input) { requireConsent(await this.hasConsent()); const record = createAccountRecord(input); await this._tx("readwrite", (a) => a.put(record)); return record; }
  async remove(id) { await this._tx("readwrite", (a) => a.delete(id)); }
  async clear() { await this._tx("readwrite", (a) => a.clear()); }
  async migrateLegacy() { requireConsent(await this.hasConsent()); const raw = localStorage.getItem(LEGACY_KEY); if (!raw) return []; let parsed; try { parsed = JSON.parse(raw); } catch { return []; } const records = parsed.map((x) => { const v = validateTransfer({ bankId: x.bankId, account: x.account, amount: null, memo: "" }); return createAccountRecord({ label: x.label, bankId: v.bankId, account: x.account }); }); await this._tx("readwrite", (a) => { records.forEach((r) => a.put(r)); }); localStorage.removeItem(LEGACY_KEY); return records; }
  subscribe(listener) { if (!this.channel) return () => {}; const fn = (e) => { if (e.data === "changed") listener(); }; this.channel.addEventListener("message", fn); return () => this.channel.removeEventListener("message", fn); }
  close() { this.channel?.close(); }
}
