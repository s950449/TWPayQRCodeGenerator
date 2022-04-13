import json
import requests
import csv
import qrcode
import sys
import argparse
import mimetypes
from PIL import Image
from PIL import ImageDraw
import math
from PIL import ImageFont
API_url = "https://i-tw.org/twpay/api"
def call_API(BankID,Account,offline):
    if offline:
        ret = offline_genstr(BankID, Account)
        return ret
    my_params = {"Bank": BankID,"Acc": Account}
    r = requests.get(API_url,params = my_params)
    if r.status_code != 200:
        raise ("Failed to generate code with input:",my_params)
    response = r.json()
    if response["Success"] != '1':
        raise RuntimeError("Failed to generate code with input:",my_params)
    #print(response)
    return response['String']
def gencode(data_str,name,BankID,Account):
    qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=10,
    border=4,
)
    qr.add_data(data_str)
    img = qr.make_image(fill_color="black", back_color="white").convert('RGB')
    width,height = img.size
    output_width = 650
    output_height = 650
    x1 = int(math.floor(output_width - width)/2)
    y1 = int(math.floor(output_height - height)/2)
    newImg = Image.new("RGB",(output_width,output_height),(255,255,255))
    newImg.paste(img,(x1,y1,x1+width,y1+height))
    draw = ImageDraw.Draw(newImg)
    description = name+' ('+BankID+') '+Account
    cjk_font = ImageFont.FreeTypeFont("fonts/NotoSansCJKtc-Light.otf",size=24)
    t_w, t_h = draw.textsize(description, cjk_font)
    draw.text(((output_width - t_w) / 2,output_height-50),description,(0,0,0),font=cjk_font)
    newImg.save(name+".png")
def prepare_BICList():
    ret = dict()
    biccsv = "data/BIC.csv"
    file_type,file_encoding = mimetypes.guess_type(biccsv)
    if file_type != "text/csv": 
        raise RuntimeError("data/BIC.csv is not csv file")
    with open(biccsv) as biclist:
        rows = csv.DictReader(biclist) 
        for row in rows:
            ret[row["BIC"]] = row["Name"]
    return ret
def offline_genstr(BankID,Account):
    Account = Account.strip()  
    AccountLength = len(Account) - 1
    if AccountLength > 16:
        raise RuntimeError("Account Length is greater than 16")
      
    Account = Account.zfill(16)
    print(Account)
    ret = 'TWQRP://'+BankID+'NTTransfer/158/02/V1?D6='+Account+'&D5='+BankID+'&D10=901'
    return ret   
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("inputFile",type=str,help="Input File")
    parser.add_argument("--offline",action="store_true",help="Offline mode")
    args = parser.parse_args()
    offline = args.offline
    file_type,file_encoding = mimetypes.guess_type(args.inputFile)
    if file_type != "text/csv":   
        raise RuntimeError("Input is not csv file")
    BIC_List = prepare_BICList()

    with open(sys.argv[1],newline='') as csvfile:
        rows = csv.DictReader(csvfile)
        for row in rows:
                if row["BankID"] in BIC_List:          
                    data_str = call_API(row["BankID"],row["Account"],offline)
                    gencode(data_str,BIC_List[row["BankID"]],row["BankID"],row["Account"])