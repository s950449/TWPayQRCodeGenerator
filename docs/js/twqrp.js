/**
 * TWQRP 編碼邏輯（移植自 app.py offline_genstr）
 *
 * 格式：TWQRP://{BankID}NTTransfer/158/02/V1?D6={Account}&D5={BankID}&D10=901[&D1={Amount}00]&D9={Msg}
 */

const TWQRP_AMOUNT_MAX = 9999999999999999;

/**
 * 驗證並產生 TWQRP 字串
 * @param {string} bankId  - 金融機構代碼（如 "004"）
 * @param {string} account - 帳號
 * @param {string|number|null} amount - 金額（選填）
 * @param {string} msg     - 備註（選填，<20 字）
 * @returns {string} TWQRP 編碼字串
 * @throws {Error} 驗證失敗時拋出錯誤
 */
function twqrpEncode(bankId, account, amount, msg) {
  // 驗證帳號
  account = account.trim();
  if (account.length === 0) {
    throw new Error("請輸入帳號");
  }
  if (account.length - 1 > 16) {
    throw new Error("帳號長度超過 16 位");
  }
  // 補零至 16 位
  account = account.padStart(16, "0");

  // 驗證備註
  if (msg == null) {
    msg = "";
  }
  if (msg.length >= 20) {
    throw new Error("備註長度需小於 20 字");
  }

  // 驗證金額
  var amountFlag = false;
  if (amount != null && amount !== "") {
    var amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum < 1 || amountNum > TWQRP_AMOUNT_MAX) {
      throw new Error("金額需介於 1 ~ " + TWQRP_AMOUNT_MAX);
    }
    amountFlag = true;
    amount = amountNum;
  }

  // 組合 TWQRP 字串
  var ret =
    "TWQRP://" +
    bankId +
    "NTTransfer/158/02/V1?D6=" +
    account +
    "&D5=" +
    bankId +
    "&D10=901";

  if (amountFlag) {
    ret += "&D1=" + amount + "00";
  }

  ret += "&D9=" + msg;

  return ret;
}
