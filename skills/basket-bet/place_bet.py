#!/usr/bin/env python3
"""
Get a signed quote and place a bet on a PolyBaskets basket.
Calls vara-wallet via subprocess to avoid shell escaping issues.

Usage:
  python3 place_bet.py --user 0x... --basket-id 2 --amount 100000000000000 \
    --bet-lane 0x... --voucher 0x... --idl path/to/bet_lane_client.idl \
    --quote-url https://bet-quote-service-production.up.railway.app

All arguments are required. The script:
  1. Requests a signed quote from the bet-quote-service
  2. Converts the hex signature to a byte array
  3. Calls vara-wallet PlaceBet with properly formatted args
"""

import argparse
import json
import subprocess
import sys
import urllib.request


def main():
    p = argparse.ArgumentParser(description="Get quote + place bet atomically")
    p.add_argument("--user", required=True, help="Hex address of the bettor")
    p.add_argument("--basket-id", required=True, type=int, help="Basket ID (integer)")
    p.add_argument("--amount", required=True, help="Bet amount in raw units (string)")
    p.add_argument("--bet-lane", required=True, help="BetLane program ID (hex)")
    p.add_argument("--voucher", required=True, help="Voucher ID (hex)")
    p.add_argument("--idl", required=True, help="Path to bet_lane_client.idl")
    p.add_argument("--quote-url", required=True, help="Bet quote service base URL")
    p.add_argument("--account", default="agent", help="Wallet account name")
    args = p.parse_args()

    # 1. Get signed quote
    quote_endpoint = f"{args.quote_url}/api/bet-lane/quote"
    body = json.dumps({
        "user": args.user,
        "basketId": args.basket_id,
        "amount": args.amount,
        "targetProgramId": args.bet_lane,
    }).encode()

    req = urllib.request.Request(
        quote_endpoint,
        data=body,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            quote = json.loads(resp.read())
    except Exception as e:
        print(json.dumps({"error": f"Quote request failed: {e}"}), file=sys.stderr)
        sys.exit(1)

    if "payload" not in quote:
        print(json.dumps({"error": "Invalid quote response", "response": quote}), file=sys.stderr)
        sys.exit(1)

    # 2. Convert hex signature to byte array
    sig = quote["signature"]
    quote["signature"] = list(bytes.fromhex(sig[2:] if sig.startswith("0x") else sig))

    # 3. Build args JSON
    call_args = json.dumps([args.basket_id, args.amount, quote])

    # 4. Call vara-wallet
    cmd = [
        "vara-wallet",
        "--account", args.account,
        "call", args.bet_lane,
        "BetLane/PlaceBet",
        "--args", call_args,
        "--voucher", args.voucher,
        "--idl", args.idl,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
