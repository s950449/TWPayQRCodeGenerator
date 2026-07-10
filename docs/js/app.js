import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";
import { TWQRP_FEE_LIST, twqrpBillEncode, twqrpEncode } from "./twqrp.js";
import { SavedAccountStore } from "./saved-accounts.js";
import { LatestOperation } from "./operation-controller.js";
import { runBatch } from "./batch-runner.js";
import { commitRenderedResult } from "./rendered-state.js";

// ===== Constants =====
var QR_SIZE = 650;
var FONT_SIZE = 24;
var FONT_FAMILY = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

// ===== BIC lookup map =====
var bicMap = {};
BIC_LIST.forEach(function (item) {
  bicMap[item.bic] = item.name;
});

// ===== DOM Elements =====
var bankSelect = document.getElementById("bank-select");
var accountInput = document.getElementById("account-input");
var amountInput = document.getElementById("amount-input");
var msgInput = document.getElementById("msg-input");
var qrForm = document.getElementById("qr-form");
var generateBtn = document.getElementById("generate-btn");
var resultArea = document.getElementById("result-area");
var qrCanvas = document.getElementById("qr-canvas");
var qrInfo = document.getElementById("qr-info");
var downloadBtn = document.getElementById("download-btn");
var errorMsg = document.getElementById("error-msg");

var savedSelect = document.getElementById("saved-select");
var savedDeleteBtn = document.getElementById("saved-delete-btn");
var saveAccountBtn = document.getElementById("save-account-btn");
var savedConsent = document.getElementById("saved-consent");
var savedImportBtn = document.getElementById("saved-import-btn");
var savedClearBtn = document.getElementById("saved-clear-btn");
var savedStore = new SavedAccountStore();

var feeSelect = document.getElementById("fee-select");
var feeGroup = document.getElementById("fee-group");
var feeHint = document.getElementById("fee-hint");
var feeServiceFee = document.getElementById("fee-service-fee");
var amountLabel = document.getElementById("amount-label");
var modeTabs = document.querySelectorAll(".mode-tab");
var transferOnlyEls = document.querySelectorAll(".transfer-only");
var billOnlyEls = document.querySelectorAll(".bill-only");

var currentMode = "transfer";

var batchHeader = document.getElementById("batch-header");
var batchBody = document.getElementById("batch-body");
var fileDrop = document.getElementById("file-drop");
var csvInput = document.getElementById("csv-input");
var fileName = document.getElementById("file-name");
var batchBtn = document.getElementById("batch-btn");
var batchProgress = document.getElementById("batch-progress");
var singleJobs = new LatestOperation();
var batchJobs = new LatestOperation();
var lastRendered = null;

// ===== Initialize Bank Select =====
BIC_LIST.forEach(function (item) {
  var opt = document.createElement("option");
  opt.value = item.bic;
  opt.textContent = item.bic + " - " + item.name;
  bankSelect.appendChild(opt);
});

// ===== Saved Accounts =====
async function renderSavedSelect() {
  // Remove all options except the first placeholder
  while (savedSelect.options.length > 1) {
    savedSelect.remove(1);
  }
  var accounts = await savedStore.list();
  accounts.forEach(function (item) {
    var opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    savedSelect.appendChild(opt);
  });
  savedSelect.value = "";
}

savedSelect.addEventListener("change", async function () {
  var index = savedSelect.value;
  if (index === "") return;
  var item = (await savedStore.list()).find((x) => x.id === index);
  if (item) {
    bankSelect.value = item.bankId;
    accountInput.value = item.account;
  }
});

saveAccountBtn.addEventListener("click", async function () {
  var bankId = bankSelect.value;
  var account = accountInput.value.trim();
  if (!bankId) {
    showError("請先選擇金融機構");
    return;
  }
  if (!account) {
    showError("請先輸入帳號");
    return;
  }
  hideError();

  var bankName = bicMap[bankId] || bankId;
  var lastFour = account.slice(-4);
  var defaultLabel = bankName + " " + lastFour;
  var label = prompt("請輸入常用帳號名稱", defaultLabel);
  if (label === null) return; // user cancelled
  if (!label.trim()) label = defaultLabel;

  if (!savedConsent.checked) return showError("請先同意在此裝置儲存完整帳號");
  await savedStore.setConsent();
  await savedStore.add({ label: label.trim(), bankId, account });
  renderSavedSelect();
});

savedDeleteBtn.addEventListener("click", async function () {
  var index = savedSelect.value;
  if (index === "") return;
  var item = (await savedStore.list()).find((x) => x.id === index);
  if (!item) return;
  if (!confirm("確定要刪除「" + item.label + "」？")) return;
  await savedStore.remove(item.id);
  renderSavedSelect();
});

savedStore.hasConsent().then((v) => { savedConsent.checked = v; });
savedStore.subscribe(() => { renderSavedSelect().catch((e) => showError(e.message)); });
savedImportBtn.addEventListener("click", async () => { try { if (!savedConsent.checked) return showError("請先同意在此裝置儲存完整帳號"); await savedStore.setConsent(); await savedStore.migrateLegacy(); renderSavedSelect(); } catch (e) { showError(e.message); } });
savedClearBtn.addEventListener("click", async () => { if (confirm("確定要清除全部常用帳號？")) { await savedStore.clear(); renderSavedSelect(); } });
renderSavedSelect();

// ===== Initialize Fee Select =====
function initFeeSelect() {
  var groups = {};
  TWQRP_FEE_LIST.forEach(function (item) {
    if (!groups[item.group]) {
      groups[item.group] = [];
    }
    groups[item.group].push(item);
  });

  Object.keys(groups).forEach(function (groupName) {
    var optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    groups[groupName].forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.code;
      opt.textContent = item.code.replace(/[A-Z]$/, "") + " " + item.label;
      optgroup.appendChild(opt);
    });
    feeSelect.appendChild(optgroup);
  });
}

initFeeSelect();

feeSelect.addEventListener("change", function () {
  var code = feeSelect.value;
  var item = code ? TWQRP_FEE_LIST.find(function (f) { return f.code === code; }) : null;
  if (item && item.hint) {
    feeHint.textContent = item.hint;
    feeHint.classList.remove("hidden");
  } else {
    feeHint.textContent = "";
    feeHint.classList.add("hidden");
  }
  if (item) {
    feeServiceFee.classList.remove("hidden", "free", "charged");
    if (item.serviceFee > 0) {
      feeServiceFee.textContent = "手續費：" + item.serviceFee + " 元";
      feeServiceFee.classList.add("charged");
    } else {
      feeServiceFee.textContent = "免手續費";
      feeServiceFee.classList.add("free");
    }
  } else {
    feeServiceFee.textContent = "";
    feeServiceFee.classList.add("hidden");
    feeServiceFee.classList.remove("free", "charged");
  }
});

// ===== Mode Switching =====
modeTabs.forEach(function (tab) {
  tab.addEventListener("click", function () {
    var mode = tab.getAttribute("data-mode");
    if (mode === currentMode) return;
    currentMode = mode;

    // Toggle active tab
    modeTabs.forEach(function (t) { t.classList.remove("active"); });
    tab.classList.add("active");

    // Toggle visibility
    if (mode === "bill") {
      transferOnlyEls.forEach(function (el) { el.classList.add("hidden"); });
      billOnlyEls.forEach(function (el) { el.classList.remove("hidden"); });
      bankSelect.removeAttribute("required");
      amountInput.setAttribute("required", "");
      amountLabel.innerHTML = '金額';
      accountInput.placeholder = "請輸入繳費帳號";
      saveAccountBtn.classList.add("hidden");
    } else {
      transferOnlyEls.forEach(function (el) { el.classList.remove("hidden"); });
      billOnlyEls.forEach(function (el) { el.classList.add("hidden"); });
      bankSelect.setAttribute("required", "");
      amountInput.removeAttribute("required");
      amountLabel.innerHTML = '金額 <span class="optional">（選填）</span>';
      accountInput.placeholder = "請輸入帳號";
      saveAccountBtn.classList.remove("hidden");
    }

    // Reset form & result
    singleJobs.invalidate(); lastRendered = null;
    qrForm.reset();
    renderSavedSelect();
    feeHint.textContent = "";
    feeHint.classList.add("hidden");
    feeServiceFee.textContent = "";
    feeServiceFee.classList.add("hidden");
    feeServiceFee.classList.remove("free", "charged");
    hideError();
    resultArea.classList.add("hidden");
  });
});

[bankSelect, accountInput, amountInput, msgInput, feeSelect].forEach(function (el) {
  el.addEventListener("input", function () { singleJobs.invalidate(); lastRendered = null; });
  el.addEventListener("change", function () { singleJobs.invalidate(); lastRendered = null; });
});

// ===== Error Display =====
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("show");
}

function hideError() {
  errorMsg.textContent = "";
  errorMsg.classList.remove("show");
}

// ===== Draw QR Code on Canvas =====
function drawQR(canvas, dataStr, description) {
  return new Promise(function (resolve, reject) {
    QRCode.toCanvas(document.createElement("canvas"), dataStr, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 400,
      color: { dark: "#000000", light: "#ffffff" }
    }, function (err, tmpCanvas) {
      if (err) {
        reject(err);
        return;
      }

      var ctx = canvas.getContext("2d");
      canvas.width = QR_SIZE;
      canvas.height = QR_SIZE;

      // White background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);

      // Center QR code
      var qrW = tmpCanvas.width;
      var qrH = tmpCanvas.height;
      var x = Math.floor((QR_SIZE - qrW) / 2);
      var y = Math.floor((QR_SIZE - qrH) / 2);
      ctx.drawImage(tmpCanvas, x, y);

      // Draw description text at bottom
      ctx.fillStyle = "#000000";
      ctx.font = FONT_SIZE + "px " + FONT_FAMILY;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(description, QR_SIZE / 2, QR_SIZE - 15);

      resolve();
    });
  });
}

// ===== Wait for fonts to load =====
function fontsReady() {
  if (document.fonts && document.fonts.ready) {
    return document.fonts.ready;
  }
  return Promise.resolve();
}

// ===== Single QR Generation =====
qrForm.addEventListener("submit", async function (e) {
  e.preventDefault();
  hideError();
  resultArea.classList.add("hidden");

  var account = accountInput.value;
  var amount = amountInput.value || null;
  var msg = msgInput.value || null;
  var dataStr;
  var description;

  if (currentMode === "bill") {
    // 繳費模式
    var feeCode = feeSelect.value;
    if (!feeCode) {
      showError("請選擇繳費類別");
      return;
    }

    var feeItem = TWQRP_FEE_LIST.find(function (f) { return f.code === feeCode; });
    if (!feeItem) {
      showError("無效的繳費類別");
      return;
    }

    try {
      dataStr = twqrpBillEncode(feeItem, account, amount, msg);
    } catch (err) {
      showError(err.message);
      return;
    }

    description = feeItem.label + " " + account.trim();
  } else {
    // 轉帳模式
    var bankId = bankSelect.value;
    if (!bankId) {
      showError("請選擇金融機構");
      return;
    }

    try {
      dataStr = twqrpEncode(bankId, account, amount, msg);
    } catch (err) {
      showError(err.message);
      return;
    }

    var bankName = bicMap[bankId] || bankId;
    description = bankName + " (" + bankId + ") " + account.trim();
  }

  var id = singleJobs.start();
  generateBtn.disabled = true; generateBtn.textContent = "產生中...";
  try {
    await fontsReady();
    var temporaryCanvas = document.createElement("canvas");
    await drawQR(temporaryCanvas, dataStr, description);
    var committed = commitRenderedResult(singleJobs, id, { filename: (currentMode === "bill" ? (TWQRP_FEE_LIST.find(f => f.code === feeSelect.value)?.label || feeSelect.value) : (bicMap[bankSelect.value] || bankSelect.value)) + "_" + account.trim() + ".png", description });
    if (committed === null) return;
    qrCanvas.width = temporaryCanvas.width; qrCanvas.height = temporaryCanvas.height;
    qrCanvas.getContext("2d").drawImage(temporaryCanvas, 0, 0);
    lastRendered = committed; qrInfo.textContent = description; resultArea.classList.remove("hidden");
  } catch (err) { if (singleJobs.isCurrent(id)) showError("QR Code 產生失敗：" + err.message); }
  finally { if (singleJobs.isCurrent(id)) { generateBtn.disabled = false; generateBtn.textContent = "產生 QR Code"; } }
});

// ===== Download PNG =====
downloadBtn.addEventListener("click", function () {
  if (!lastRendered) return;
  var account = accountInput.value.trim();
  var filename = lastRendered.filename;

  /*if (currentMode === "bill") {
    var feeCode = feeSelect.value;
    var feeItem = TWQRP_FEE_LIST.find(function (f) { return f.code === feeCode; });
    filename = (feeItem ? feeItem.label : feeCode) + "_" + account + ".png";
  } else {
    var bankId = bankSelect.value;
    filename = (bicMap[bankId] || bankId) + "_" + account + ".png";
  }*/

  qrCanvas.toBlob(function (blob) {
    if (window.saveAs) {
      saveAs(blob, filename);
    } else {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, "image/png");
});

// ===== Collapsible Batch Section =====
batchHeader.addEventListener("click", function () {
  batchHeader.classList.toggle("open");
  batchBody.classList.toggle("open");
});

// ===== File Drop / Select =====
fileDrop.addEventListener("click", function () {
  if (batchBtn.disabled && batchJobs.isCurrent(batchRunId)) return;
  csvInput.click();
});

fileDrop.addEventListener("dragover", function (e) {
  e.preventDefault();
  fileDrop.style.borderColor = "#2563eb";
  fileDrop.style.background = "#f8fafc";
});

fileDrop.addEventListener("dragleave", function () {
  fileDrop.style.borderColor = "#d0d5dd";
  fileDrop.style.background = "";
});

fileDrop.addEventListener("drop", function (e) {
  e.preventDefault();
  fileDrop.style.borderColor = "#d0d5dd";
  fileDrop.style.background = "";
  if (e.dataTransfer.files.length > 0) {
    csvInput.files = e.dataTransfer.files;
    onFileSelected(e.dataTransfer.files[0]);
  }
});

csvInput.addEventListener("change", function () {
  if (csvInput.files.length > 0) {
    onFileSelected(csvInput.files[0]);
  }
});

function onFileSelected(file) {
  if (batchActive) return;
  fileName.textContent = file.name;
  fileName.classList.remove("hidden");
  batchBtn.disabled = false;
}

// ===== Batch Processing =====
var batchActive = false; var batchRunId = 0;
batchBtn.addEventListener("click", async function () {
  var file = csvInput.files[0];
  if (!file || batchActive) return;
  if (file.size > 5 * 1024 * 1024) { batchProgress.textContent = "CSV 檔案過大（上限 5 MB）"; batchProgress.classList.remove("hidden"); return; }
  batchActive = true; csvInput.disabled = true; fileDrop.classList.add("disabled");
  var id = batchJobs.start(); batchRunId = id;

  batchBtn.disabled = true;
  batchProgress.classList.remove("hidden");
  batchProgress.textContent = "解析 CSV 中...";

  try {
    var results = await new Promise(function (resolve, reject) { Papa.parse(file, { header: true, skipEmptyLines: true, complete: resolve, error: reject }); });
    if (results.data.length > 5000) throw new Error("CSV 資料列數超過上限 5000");
    if (results.meta && results.meta.fields && results.meta.fields.length > 20) throw new Error("CSV 欄位數超過上限 20");
    processBatch(results.data, id);
  } catch (err) { batchProgress.textContent = "CSV 解析失敗：" + err.message; batchActive = false; csvInput.disabled = false; fileDrop.classList.remove("disabled"); batchBtn.disabled = false; }
/*  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function (results) {
      processBatch(results.data);
    },
    error: function (err) {
      batchProgress.textContent = "CSV 解析失敗：" + err.message;
      batchBtn.disabled = false;
    }
  }); */
});

function processBatch(rows, id) {
  var zip = new JSZip();
  var total = rows.length;
  var processed = 0;
  var errors = [];

  async function processNext(index) {
    if (index >= total) {
      finishBatch(zip, errors, total, id);
      return;
    }

    var row = rows[index];
    var bankId = (row.BankID || "").trim();
    var account = (row.Account || "").trim();
    var name = (row.Name || "").trim();
    var amount = row.Amount != null && row.Amount !== "" ? row.Amount : null;
    var msg = row.Msg != null && row.Msg !== "" ? row.Msg : null;

    if (!bankId || !(bankId in bicMap)) {
      errors.push((index + 1) + ": 無效的金融機構代碼 " + bankId);
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      Promise.resolve().then(function () { processNext(index + 1); });
      return;
    }

    var dataStr;
    try {
      dataStr = twqrpEncode(bankId, account, amount, msg);
    } catch (err) {
      errors.push((index + 1) + ": " + err.message);
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      Promise.resolve().then(function () { processNext(index + 1); });
      return;
    }

    var bankName = bicMap[bankId];
    var description = bankName + " (" + bankId + ") " + account;

    var tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = QR_SIZE;
    tmpCanvas.height = QR_SIZE;

    fontsReady().then(function () {
      return drawQR(tmpCanvas, dataStr, description);
    }).then(function () {
      return new Promise(function (resolve) {
        tmpCanvas.toBlob(function (blob) {
          var fname = (name || bankId + "_" + account) + ".png";
          zip.file(fname, blob);
          resolve();
        }, "image/png");
      });
    }).then(function () {
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      Promise.resolve().then(function () { processNext(index + 1); });
    }).catch(function (err) {
      errors.push((index + 1) + ": QR 產生失敗 - " + err.message);
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      processNext(index + 1);
    });
  }

  processNext(0);
}

function finishBatch(zip, errors, total, id) {
  var successCount = total - errors.length;

  if (successCount === 0) {
    batchProgress.textContent = "全部失敗。" + errors.join("；");
    batchBtn.disabled = false; batchActive = false; csvInput.disabled = false; fileDrop.classList.remove("disabled");
    return;
  }

  batchProgress.textContent = "打包 ZIP 中...";

  zip.generateAsync({ type: "blob" }).then(function (blob) {
    if (batchJobs.isCurrent(id)) saveAs(blob, "TWPayQRCodes.zip");
    var msg = "完成！成功 " + successCount + " 筆";
    if (errors.length > 0) {
      msg += "，失敗 " + errors.length + " 筆";
    }
    batchProgress.textContent = msg;
    batchBtn.disabled = false; batchActive = false; csvInput.disabled = false; fileDrop.classList.remove("disabled");
  }).catch(function (err) {
    batchProgress.textContent = "ZIP 打包失敗：" + err.message;
    batchBtn.disabled = false; batchActive = false; csvInput.disabled = false; fileDrop.classList.remove("disabled");
  });
}
