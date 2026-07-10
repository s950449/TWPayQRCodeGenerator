# 台灣Pay產生器API(J大產生器) 
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 線上版 (Vibe Coding w/Claude Opus 4.5, Javascript)
直接在瀏覽器使用，無需安裝：**[線上版 QR Code 產生器](https://s950449.github.io/TWPayQRCodeGenerator/)**

## 功能
* 支援銀行代號(Bank)以及帳戶號碼(Acc)及收款金額設定
* 在QRCode下方加入金融機構名稱以及帳戶號碼，方便辨識
    * 使用Noto Sans CJK字體
    * [金融機構代碼對照來源](https://www.fisc.com.tw/TC/OPENDATA/Comm1_MEMBER.csv)
## 所需環境
### Python Client
* 使用`pip install -r requirements.txt`或是`pipenv install`安裝所需的Library
### 靜態網頁
* 使用一個Web Server或瀏覽器
## Python Client使用
程式預設以離線方式產生 QR payload，不會把帳號、金額或備註送出到網路。

* 離線模式（預設）：`python app.py [csv-file] --output-dir output`
* 線上模式（需明確指定）：`python app.py [csv-file] --online`
  `--online` 會將每筆資料送至 `https://i-tw.org/twpay/api`；請先確認你接受向第三方揭露這些資料。
* CSV 上限為 5 MiB、1000 筆，每個欄位最多 128 個字元；`Name` 會被安全化後才用作輸出檔名。
* 輸入格式請參考 `sample.csv`。可用 `python app.py -h` 查看完整說明。
* 建議搭配台灣行動支付APP使用，並在App中確認掃描QRCode得到的內容是否正確(帳號、金融機構等)
* 使用`python app.py -h` 查看說明內容
* 輸入格式請參考`sample.csv`
## Tips
* 更新金融機構代碼 
    * 執行 `python update_bic.py` ， 將會從財金公司下載最新的CSV檔案並轉換成本產生器可用格式

## 瀏覽器版資料與隱私

瀏覽器頁面預設完全離線執行，JavaScript 依賴由本專案本機提供，不會呼叫付款 API。儲存收款帳號前必須勾選明確同意；帳號以 IndexedDB 保存並使用穩定 UUID。可匯入既有資料或按「清除全部」刪除本機保存的帳號，跨分頁會同步更新。

## 開發與驗證

在專案根目錄執行：

```bash
npm run test:js
npm run verify:vendor
python3 -m unittest discover -s tests/python -v
python3 app.py -h
python3 update_bic.py -h
```

依賴安全性可另以 `pip-audit -r requirements.txt` 檢查。CI 會在 push 與 pull request 自動執行上述檢查。
## 免責聲明    
* 使用本工具存在的風險將完全由使用者本人承擔，本工具作者不承擔任何責任
* 請謹慎使用此工具，小心詐騙，在轉帳前請確認帳號是否正確無誤
* 為了避免資訊安全方面的疑慮，建議使用各金融機構app產生的QRCode或是在轉帳時手動輸入相關資訊
* 若因使用本工具導致任何財務損失，作者一概不負任何法律責任
