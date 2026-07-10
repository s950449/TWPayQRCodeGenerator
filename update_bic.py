import argparse
from pathlib import Path
from twpay_bic import BicUpdateError, update_bic_dataset


def main():
    parser = argparse.ArgumentParser(description="更新本機 BIC 資料")
    parser.add_argument("--destination", type=Path, default=Path("data/BIC.csv"))
    args = parser.parse_args()
    import requests
    try:
        mapping = update_bic_dataset(requests.get, args.destination)
    except BicUpdateError as exc:
        parser.error(str(exc))
    print(f"updated {len(mapping)} BIC records")


if __name__ == "__main__":
    main()
        
