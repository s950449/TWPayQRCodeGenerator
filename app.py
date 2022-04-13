import json
import requests
import csv
import qrcode
import sys
import mimetypes
from PIL import Image
from PIL import ImageDraw
import math
from PIL import ImageFont
API_url = "https://i-tw.org/twpay/api"
def call_API(name,BankID,Account):
    my_params = {"Bank": BankID,"Acc": Account}
    r = requests.get(API_url,params = my_params)
    if r.status_code != 200:
        raise RuntimeError("Failed to generate code with input:",my_params)
    response = r.json()
    if response["Success"] != '1':
        raise RuntimeError("Failed to generate code with input:",my_params)
    print(response)
    qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=10,
    border=4,
)
    qr.add_data(response['String'])
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
    with open("data/BIC.csv") as biclist:
        rows = csv.DictReader(biclist) 
        for row in rows:
            ret[row["BIC"]] = row["Name"]
    return ret
def offline_gen(name,BankID,Account):
    #TBD
    exit()    
if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python app.py [csv-file]")
        exit()
    file_type,file_encoding = mimetypes.guess_type(sys.argv[1])
    if file_type != "text/csv":   
        raise RuntimeError("Input is not csv file")
    BIC_List = prepare_BICList()

    with open(sys.argv[1],newline='') as csvfile:
        rows = csv.DictReader(csvfile)
        for row in rows:
                if row["BankID"] in BIC_List:
                    call_API(BIC_List[row["BankID"]],row["BankID"],row["Account"])