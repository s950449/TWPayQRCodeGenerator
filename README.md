# 台灣Pay產生器API(J大產生器) Python client
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能
* 目前只支援銀行代號(Bank)以及帳戶號碼(Acc)，不支援收款金額設定及備註等功能
* 在QRCode下方加入金融機構名稱以及帳戶號碼，方便辨識
    * 使用Noto Sans CJK字體
    * [金融機構代碼對照來源](https://www.fisc.com.tw/TC/OPENDATA/Comm1_MEMBER.csv)
## 所需環境
* 使用`pip install -r requirements.txt`或是`pipenv install`安裝所需的Library
## 使用
* (建議使用)線上版：使用 https://github.com/jefflin555/twpay 的 API，連線到 https://i-tw.org/twpay/api ，並使用Python的QRCode library產生QRCode
    * 執行
        `python app.py [csv-file]`
* (測試中)離線版:
    * 編碼格式: `'TWQRP://'+銀行代號+'NTTransfer/158/02/V1?D6='+帳戶號碼+'&D5='+銀行代號+'&D10=901'`    
        * 格式參照原文[PTT MobilePay](https://www.ptt.cc/bbs/MobilePay/M.1543779469.A.577.html)
    * 執行 `python app.py [csv-file] --offline`
    * 此版本尚未支援檢查帳號字串是否合法
* 建議搭配台灣行動支付APP使用，並在App中確認掃描QRCode得到的內容是否正確(帳號、金融機構等)
* 使用`python app.py -h` 查看說明內容
* 輸入格式請參考`sample.csv`
## Tips
* 更新金融機構代碼 
    * 執行 `python update_bic.py` ， 將會從財金公司下載最新的CSV檔案並轉換成本產生器可用格式
## 免責聲明    
* 使用本工具存在的風險將完全由使用者本人承擔，本工具作者不承擔任何責任
* 請謹慎使用此工具，小心詐騙，在轉帳前請確認帳號是否正確無誤
* 為了避免資訊安全方面的疑慮，建議使用各金融機構app產生的QRCode或是在轉帳時手動輸入相關資訊
* 若因使用本工具導致任何財務損失，作者一概不負任何法律責任