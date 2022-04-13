# 台灣Pay產生器API(J大產生器) Python client
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能
* 目前只支援銀行代號(Bank)以及帳戶號碼(Acc)，不支援收款金額設定及備註等功能
* 在QRCode下方加入金融機構名稱以及帳戶號碼，方便辨識
    * 使用Noto Sans CJK字體
## 使用
* (建議使用)線上版：使用 https://github.com/jefflin555/twpay 的 API，連線到 https://i-tw.org/twpay/api，並使用Python的QRCode library產生QRCode
    * 執行
        `python app.py [csv-file]`
* (測試中)離線版:
    * 編碼格式: `'TWQRP://'+銀行代號+'NTTransfer/158/02/V1?D6='+帳戶號碼+'&D5='+銀行代號+'&D10=901'`    
    * 執行 `python app.py [csv-file] --offline`
* 建議搭配台灣行動支付APP使用，並在App中確認從QRCode的內容是否正確(帳號、金融機構等)
* 使用`python app.py -h` 查看說明內容
## 免責聲明    
* 使用本工具存在的風險將完全由使用者本人承擔，本工具作者不承擔任何責任
* 請謹慎使用此工具，小心詐騙，在轉帳前請確認帳號是否有誤