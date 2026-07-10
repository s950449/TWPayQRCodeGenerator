/**
 * TWQRP 編碼邏輯（移植自 app.py offline_genstr）
 *
 * 轉帳格式：TWQRP://{BankID}NTTransfer/158/02/V1?D6={Account}&D5={BankID}&D10=901[&D1={Amount}00]&D9={Msg}
 * 繳費格式：TWQRP://{FeeName}/158/03/V1?{PartialString}&D1={Amount}00&D7={Account}
 */

export const TWQRP_AMOUNT_MAX = 9999999999999999n;
const RESERVED_VALUE_CHARS = /[&=?#%\u0000-\u001F\u007F]/u;
export class TwqrpValidationError extends Error {}
function text(value, field) { const result=String(value ?? "").trim(); if ([...result].length>128) throw new TwqrpValidationError(`${field}過長`); return result; }
function amount(value, required) { if (value==null||value==="") { if(required) throw new TwqrpValidationError("繳費模式需輸入金額"); return null; } const result=text(value,"金額"); if(!/^[1-9][0-9]*$/.test(result)||BigInt(result)>TWQRP_AMOUNT_MAX) throw new TwqrpValidationError("金額需介於 1 ~ 9999999999999999"); return result; }
function memo(value) { const result=text(value,"備註"); if([...result].length>19||RESERVED_VALUE_CHARS.test(result)) throw new TwqrpValidationError("備註包含不支援的字元"); return result; }

// ===== 繳費資料 =====
export const TWQRP_FEE_LIST = [
  // 信用卡帳單
  { code: "006A", feeName: "合庫信用卡", label: "合作金庫 信用卡", group: "信用卡帳單",
    partialString: "D3=ARCD0UqJMB6l&D11=00,0060067079912831443144000100170003&D15=000", spec: "Regular",
    hint: "", serviceFee: 0 },
  { code: "007A", feeName: "信用卡費", label: "第一銀行 信用卡", group: "信用卡帳單",
    partialString: "D3=Ae/pdiFSI3Ke&D11=00,0070071000081770110685007600817003&D15=000", spec: "Regular",
    hint: "可輸入「卡號」或「存戶編號」共 16 位", serviceFee: 0 },
  { code: "008A", feeName: "華南銀行信用卡費", label: "華南銀行 信用卡", group: "信用卡帳單",
    partialString: "D3=Ac98MPe0FDlt&D11=00,0080081000005803000100012800058003&D15=000", spec: "Regular",
    hint: "可輸入「卡號」或「繳款編號」共 16 位", serviceFee: 0 },
  { code: "009A", feeName: "彰化銀行信用卡費", label: "彰化銀行 信用卡", group: "信用卡帳單",
    partialString: "D3=Af70SVlXU70v&D11=00,0099910000204040019001999900204003&D15=000", spec: "Regular",
    hint: "請輸入帳單上的 14 位數 ATM 轉帳號碼（末 8 碼應與身分證字號末 8 碼相同，請勿輸入第二段繳款條碼）", serviceFee: 0 },
  { code: "017A", feeName: "兆豐商銀信用卡費", label: "兆豐商銀 信用卡", group: "信用卡帳單",
    partialString: "D3=AQefGD3amu6l&D11=00,0170171126683296001000000100112003&D15=000", spec: "Regular",
    hint: "", serviceFee: 10 },
  { code: "103A", feeName: "新光銀行信用卡繳款", label: "新光銀行 信用卡", group: "信用卡帳單",
    partialString: "D3=Ac5FpKui64Zz&D11=00,1039910000104040011030999900104003", spec: "Regular",
    hint: "一般卡請輸入「316」+ 身分證字號 11 碼（英文字母轉數字：A=01、B=02 依此類推）；商務卡請輸入「316000」+ 統一編號 8 碼", serviceFee: 0 },
  { code: "805A", feeName: "遠東商銀信用卡繳款", label: "遠東商銀 信用卡", group: "信用卡帳單",
    partialString: "D3=AfAEmVIr4NSI&D11=00,8059910000069090010001999900069003&D15=000", spec: "Regular",
    hint: "請輸入「529」+ 正卡持卡人身分證字號 11 碼（英文字母轉數字：A=01、B=02 依此類推）", serviceFee: 0 },
  { code: "807B", feeName: "永豐信用卡帳單繳費", label: "永豐銀行 信用卡", group: "信用卡帳單",
    partialString: "D3=ARoA3fZ0L+Gs&D11=00,8078072559276081058105000103400003&D15=000", spec: "Sinopa",
    hint: "請輸入「信用卡卡號」或「00598」+ 身分證字號 11 碼（英文字母轉數字：A=01、B=02 依此類推）。永豐已終止台灣 Pay 相關業務，部分銀行 App 仍可掃碼繳款", serviceFee: 10 },

  // 公用事業費
  { code: "0061", feeName: "台灣自來水", label: "台灣自來水", group: "公用事業費",
    partialString: "D3=ASap8GBcaZae&D4=99991231&D8=水費帳單&D10=901&D11=00,0060065224244455005500000100161803&D14=2,FN046286,201903", spec: "Water",
    hint: "請輸入水號英數字共 11 碼。請勿輸入北水帳單", serviceFee: 0 },

  // 政府保險費
  { code: "0041", feeName: "衛生福利部中央健康保險署", label: "健保", group: "政府保險費",
    partialString: "D3=AWV3cihi1B9q&D10=901&D11=00,0040040862840750238157236400155808&D15=000&D8=個人繳款單", spec: "NHI",
    hint: "請輸入「銷帳編號」（非繳款單編號）", serviceFee: 3 },
  { code: "0040", feeName: "國保", label: "國民年金", group: "政府保險費",
    partialString: "D3=AT65E2NDwehQ&D10=901&D11=00,0040040376980850178184719006041813&D15=000&D16=國民年金保險費&D12=99991231235959", spec: "Regular",
    hint: "", serviceFee: 3 }
];

/*
 * 驗證並產生 TWQRP 繳費字串
 * @param {object} feeItem  - TWQRP_FEE_LIST 中的項目
 * @param {string} account  - 繳費帳號/單號
 * @param {string|number} amount - 金額（必填）
 * @param {string} memo     - 備註（選填）
 * @returns {string} TWQRP 繳費編碼字串
 * @throws {Error} 驗證失敗時拋出錯誤
 */
export function twqrpBillEncode(feeItem, account, rawAmount, rawMemo) {
  if (!TWQRP_FEE_LIST.includes(feeItem)) throw new TwqrpValidationError("繳費項目無效");
  const accountText=text(account,"繳費帳號");
  if (!/^[A-Za-z0-9]{1,64}$/.test(accountText)) throw new TwqrpValidationError("請輸入繳費帳號");
  const amountText=amount(rawAmount,true), memoText=memo(rawMemo);
  const amountNum=amountText;
  // 驗證帳號

  // 組合基本 TWQRP 繳費字串
  var uriString =
    "TWQRP://" + feeItem.feeName + "/158/03/V1?" +
    feeItem.partialString +
    "&D1=" + amountNum + "00" +
    "&D7=" + account;

  // 附加備註
  if (memoText) uriString += "&D9=" + memoText;

  // 依 spec 處理特殊 URL 包裝
  var result;
  switch (feeItem.spec) {
    case "Water":
      result = "https://www.water.gov.tw/member_mobilesearch_act.aspx?" + encodeURIComponent(uriString);
      break;
    case "Sinopa":
      result = "https://paybill.sinopac.com/CreditCard/BarcodeQueryBill/" + account + "?" + encodeURIComponent(uriString);
      break;
    case "NHI":
      result = "https://cloudicweb.nhi.gov.tw/nhiapp/PayBill/pay.aspx?billtype=02&billno=" + account + "&billamt=" + amountNum + "?" + encodeURIComponent(uriString);
      break;
    default:
      result = uriString;
      break;
  }

  return result;
}

/**
 * 驗證並產生 TWQRP 字串
 * @param {string} bankId  - 金融機構代碼（如 "004"）
 * @param {string} account - 帳號
 * @param {string|number|null} amount - 金額（選填）
 * @param {string} msg     - 備註（選填，<20 字）
 * @returns {string} TWQRP 編碼字串
 * @throws {Error} 驗證失敗時拋出錯誤
 */
function legacyTwqrpEncode(bankId, account, amount, msg) {
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

export function validateTransfer({bankId, account, amount: rawAmount, memo: rawMemo}) {
  const b=text(bankId,"金融機構代碼"), a=text(account,"帳號");
  if(!/^[0-9]{3}$/.test(b)) throw new TwqrpValidationError("金融機構代碼無效");
  if(!/^[0-9]{1,16}$/.test(a)) throw new TwqrpValidationError("帳號必須是 1 至 16 位數字");
  return {bankId:b,account:a.padStart(16,"0"),amount:amount(rawAmount,false),memo:memo(rawMemo)};
}
export function encodeTransfer(input) { const f=validateTransfer(input); let p=`TWQRP://${f.bankId}NTTransfer/158/02/V1?D6=${f.account}&D5=${f.bankId}&D10=901`; if(f.amount!==null)p+=`&D1=${f.amount}00`; return {fields:f,payload:`${p}&D9=${f.memo}`}; }
export function parseTransferPayload(payload) {
  const m=/^TWQRP:\/\/([0-9]{3})NTTransfer\/158\/02\/V1\?(.+)$/u.exec(payload); if(!m) throw new TwqrpValidationError("線上服務回傳的 TWQRP 格式無效"); const s=new Map(), allow=new Set(["D1","D5","D6","D9","D10"]);
  for(const pair of m[2].split("&")){const [k,v,...x]=pair.split("="); if(!k||!allow.has(k)||x.length||s.has(k)) throw new TwqrpValidationError("TWQRP 欄位重複或格式無效"); s.set(k,v??"");}
  if(!s.has("D9")||s.get("D5")!==m[1]||!/^[0-9]{16}$/.test(s.get("D6")??"")||s.get("D10")!=="901") throw new TwqrpValidationError("TWQRP 必要欄位無效"); const r=s.get("D1"); const a=r==null?null:r.endsWith("00")?r.slice(0,-2):null; if(r!=null&&(!a||!/^[1-9][0-9]*$/.test(a))) throw new TwqrpValidationError("TWQRP 金額無效"); return {bankId:m[1],account:s.get("D6"),amount:a,memo:s.get("D9")??""};
}
export const twqrpEncode = (bankId, account, amountValue, msg) => encodeTransfer({bankId, account, amount: amountValue, memo: msg}).payload;
