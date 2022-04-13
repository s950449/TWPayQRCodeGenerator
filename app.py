import json
import requests
import csv
import sys
import mimetypes
if __name__ == '__main__':

    if len(sys.argv) != 2:
        print("Usage: python app.py [csv-file]")
        exit()
    file_type,file_encoding = mimetypes.guess_type(sys.argv[1])
    if(file_type != "text/csv"):   
        raise RuntimeError("Input is not csv file")
    with open(sys.argv[1],newline='') as csvfile:
        rows = csv.DictReader(csvfile)
        for row in rows:
            print(row["Name"],row["BankID"],row["Account"])