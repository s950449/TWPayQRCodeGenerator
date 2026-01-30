import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";

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

var batchHeader = document.getElementById("batch-header");
var batchBody = document.getElementById("batch-body");
var fileDrop = document.getElementById("file-drop");
var csvInput = document.getElementById("csv-input");
var fileName = document.getElementById("file-name");
var batchBtn = document.getElementById("batch-btn");
var batchProgress = document.getElementById("batch-progress");

// ===== Initialize Bank Select =====
BIC_LIST.forEach(function (item) {
  var opt = document.createElement("option");
  opt.value = item.bic;
  opt.textContent = item.bic + " - " + item.name;
  bankSelect.appendChild(opt);
});

// ===== Saved Accounts =====
var SAVED_KEY = "twpay_saved_accounts";

function loadSavedAccounts() {
  try {
    var data = localStorage.getItem(SAVED_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveSavedAccounts(list) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

function renderSavedSelect() {
  // Remove all options except the first placeholder
  while (savedSelect.options.length > 1) {
    savedSelect.remove(1);
  }
  var accounts = loadSavedAccounts();
  accounts.forEach(function (item, index) {
    var opt = document.createElement("option");
    opt.value = index;
    opt.textContent = item.label;
    savedSelect.appendChild(opt);
  });
  savedSelect.value = "";
}

savedSelect.addEventListener("change", function () {
  var index = savedSelect.value;
  if (index === "") return;
  var accounts = loadSavedAccounts();
  var item = accounts[index];
  if (item) {
    bankSelect.value = item.bankId;
    accountInput.value = item.account;
  }
});

saveAccountBtn.addEventListener("click", function () {
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

  var accounts = loadSavedAccounts();
  accounts.push({ label: label.trim(), bankId: bankId, account: account });
  saveSavedAccounts(accounts);
  renderSavedSelect();
});

savedDeleteBtn.addEventListener("click", function () {
  var index = savedSelect.value;
  if (index === "") return;
  var accounts = loadSavedAccounts();
  var item = accounts[index];
  if (!item) return;
  if (!confirm("確定要刪除「" + item.label + "」？")) return;
  accounts.splice(index, 1);
  saveSavedAccounts(accounts);
  renderSavedSelect();
});

renderSavedSelect();

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
qrForm.addEventListener("submit", function (e) {
  e.preventDefault();
  hideError();
  resultArea.classList.add("hidden");

  var bankId = bankSelect.value;
  var account = accountInput.value;
  var amount = amountInput.value || null;
  var msg = msgInput.value || null;

  if (!bankId) {
    showError("請選擇金融機構");
    return;
  }

  var dataStr;
  try {
    dataStr = twqrpEncode(bankId, account, amount, msg);
  } catch (err) {
    showError(err.message);
    return;
  }

  var bankName = bicMap[bankId] || bankId;
  var description = bankName + " (" + bankId + ") " + account.trim();

  generateBtn.disabled = true;
  generateBtn.textContent = "產生中...";

  fontsReady().then(function () {
    return drawQR(qrCanvas, dataStr, description);
  }).then(function () {
    qrInfo.textContent = description;
    resultArea.classList.remove("hidden");
  }).catch(function (err) {
    showError("QR Code 產生失敗：" + err.message);
  }).finally(function () {
    generateBtn.disabled = false;
    generateBtn.textContent = "產生 QR Code";
  });
});

// ===== Download PNG =====
downloadBtn.addEventListener("click", function () {
  var bankId = bankSelect.value;
  var account = accountInput.value.trim();
  var filename = (bicMap[bankId] || bankId) + "_" + account + ".png";

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
  fileName.textContent = file.name;
  fileName.classList.remove("hidden");
  batchBtn.disabled = false;
}

// ===== Batch Processing =====
batchBtn.addEventListener("click", function () {
  var file = csvInput.files[0];
  if (!file) return;

  batchBtn.disabled = true;
  batchProgress.classList.remove("hidden");
  batchProgress.textContent = "解析 CSV 中...";

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function (results) {
      processBatch(results.data);
    },
    error: function (err) {
      batchProgress.textContent = "CSV 解析失敗：" + err.message;
      batchBtn.disabled = false;
    }
  });
});

function processBatch(rows) {
  var zip = new JSZip();
  var total = rows.length;
  var processed = 0;
  var errors = [];

  function processNext(index) {
    if (index >= total) {
      finishBatch(zip, errors, total);
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
      processNext(index + 1);
      return;
    }

    var dataStr;
    try {
      dataStr = twqrpEncode(bankId, account, amount, msg);
    } catch (err) {
      errors.push((index + 1) + ": " + err.message);
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      processNext(index + 1);
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
      processNext(index + 1);
    }).catch(function (err) {
      errors.push((index + 1) + ": QR 產生失敗 - " + err.message);
      processed++;
      batchProgress.textContent = "處理中 " + processed + " / " + total;
      processNext(index + 1);
    });
  }

  processNext(0);
}

function finishBatch(zip, errors, total) {
  var successCount = total - errors.length;

  if (successCount === 0) {
    batchProgress.textContent = "全部失敗。" + errors.join("；");
    batchBtn.disabled = false;
    return;
  }

  batchProgress.textContent = "打包 ZIP 中...";

  zip.generateAsync({ type: "blob" }).then(function (blob) {
    saveAs(blob, "TWPayQRCodes.zip");
    var msg = "完成！成功 " + successCount + " 筆";
    if (errors.length > 0) {
      msg += "，失敗 " + errors.length + " 筆";
    }
    batchProgress.textContent = msg;
    batchBtn.disabled = false;
  }).catch(function (err) {
    batchProgress.textContent = "ZIP 打包失敗：" + err.message;
    batchBtn.disabled = false;
  });
}
