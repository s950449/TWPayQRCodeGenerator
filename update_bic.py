import requests
import csv
import json
CSV_URL = 'https://www.fisc.com.tw/TC/OPENDATA/Comm1_MEMBER.csv'
CSV_FILE = 'data/BIC.csv'
if __name__ == "__main__":
    r = requests.get(CSV_URL)
    if r.status_code != 200:
        raise RuntimeError(r.status_code)
    open(CSV_FILE,'wb').write(r.content)
    output = dict()
    with open(CSV_FILE,'r',encoding='utf-8-sig') as csvfile:
        rows = csv.DictReader(csvfile)
        output
        for row in rows:
            if row["業務別"] == '跨行自動化服務機器業務(金融卡)':
                output[row['銀行代號/BIC']] = row['金融機構名稱']
    with open(CSV_FILE,'w') as csvfile:                
        writer = csv.DictWriter(csvfile,fieldnames=['BIC','Name'])
        writer.writeheader()
        for row in output:
           writer.writerow( {'BIC': row,'Name':output[row]})             
        
