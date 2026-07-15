# -*- coding: utf-8 -*-
"""
data/tickers.json에 등록된 심볼의 일봉 종가 이력을 야후 파이낸스에서 받아
data/prices/{심볼}.json 으로 저장한다. GitHub Actions와 로컬에서 공용.

사용: python scripts/fetch_prices.py [심볼 ...]
  인자를 주면 해당 심볼을 tickers.json에 추가한 뒤 전체를 갱신한다.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PRICES = DATA / "prices"

# 앱이 항상 필요로 하는 기본 심볼(벤치마크·환율)
CORE = ["^KS11", "^GSPC", "KRW=X"]

RANGE = "10y"


def safe_name(symbol: str) -> str:
    """파일명에 못 쓰는 문자를 _로 치환 (^GSPC -> _GSPC.json)"""
    return "".join(c if c.isalnum() or c in ".-" else "_" for c in symbol)


def fetch_chart(symbol: str) -> dict:
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
        f"?range={RANGE}&interval=1d&events=div,splits"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    res = d["chart"]["result"][0]
    meta = res["meta"]
    ts = res.get("timestamp") or []
    quote = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose")
    closes = quote.get("close") or []
    out = []
    for i, t in enumerate(ts):
        c = closes[i]
        if c is None:
            continue
        # 거래소 현지 날짜로 변환 (gmtoffset 적용)
        day = time.strftime("%Y-%m-%d", time.gmtime(t + meta.get("gmtoffset", 0)))
        a = adj[i] if adj and adj[i] is not None else c
        out.append([day, round(c, 4), round(a, 4)])
    # 종목명: 한국 상장(.KS/.KQ)은 네이버에서 한글명, 그 외는 야후 영문명
    name = korean_name(symbol) or meta.get("longName") or meta.get("shortName") or symbol
    return {
        "symbol": symbol,
        "currency": meta.get("currency"),
        "name": name,
        "exchange": meta.get("exchangeName"),
        "updatedAt": int(time.time()),
        # [날짜, 종가, 수정종가(배당·분할 반영)]
        "closes": out,
    }


def korean_name(symbol):
    """한국 상장 종목(005930.KS 등)의 한글 종목명을 네이버에서 조회. 실패 시 None."""
    m = symbol.split(".")
    if len(m) != 2 or m[1] not in ("KS", "KQ") or not m[0].isdigit():
        return None
    try:
        url = f"https://m.stock.naver.com/api/stock/{m[0]}/basic"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.load(r)
        return d.get("stockName") or None
    except Exception:
        return None


def main():
    PRICES.mkdir(parents=True, exist_ok=True)
    tickers_file = DATA / "tickers.json"
    tickers = []
    if tickers_file.exists():
        tickers = json.loads(tickers_file.read_text(encoding="utf-8")).get("symbols", [])

    for arg in sys.argv[1:]:
        if arg not in tickers:
            tickers.append(arg)

    symbols = list(dict.fromkeys(CORE + tickers))
    ok, failed = [], []
    for sym in symbols:
        try:
            data = fetch_chart(sym)
            path = PRICES / f"{safe_name(sym)}.json"
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            ok.append(sym)
            print(f"OK   {sym:12s} {data['name']} ({len(data['closes'])} days)")
        except Exception as e:
            failed.append(sym)
            print(f"FAIL {sym:12s} {e}")
        time.sleep(0.5)  # 야후 요청 간격

    tickers_file.write_text(
        json.dumps({"symbols": tickers}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    meta = {
        "updatedAt": int(time.time()),
        "symbols": ok,
        "failed": failed,
        "files": {s: f"{safe_name(s)}.json" for s in ok},
    }
    (DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(ok)} updated, {len(failed)} failed -> data/meta.json")


if __name__ == "__main__":
    main()
