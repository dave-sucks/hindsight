"""
Pure Python technical indicator calculations.
No external dependencies — works on any list of closing prices.
"""
from typing import Optional


def calc_ema(values: list[float], period: int) -> list[float]:
    """Exponential Moving Average."""
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    ema = [sum(values[:period]) / period]
    for v in values[period:]:
        ema.append(v * k + ema[-1] * (1 - k))
    return ema


def calc_sma(values: list[float], period: int) -> Optional[float]:
    """Simple Moving Average of the last N values."""
    if len(values) < period:
        return None
    return round(sum(values[-period:]) / period, 4)


def calc_rsi(closes: list[float], period: int = 14) -> Optional[float]:
    """RSI-14. Returns 0-100, or None if insufficient data."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0.0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0.0 for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def calc_macd(
    closes: list[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """
    MACD line, Signal line, Histogram.
    Returns (None, None, None) if insufficient data.
    """
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)
    if not ema_fast or not ema_slow:
        return None, None, None

    # Align lengths — ema_slow is shorter
    offset = len(ema_fast) - len(ema_slow)
    ema_fast_aligned = ema_fast[offset:]
    macd_line = [ema_fast_aligned[i] - ema_slow[i] for i in range(len(ema_slow))]

    signal_line = calc_ema(macd_line, signal)
    if not signal_line:
        return round(macd_line[-1], 4), None, None

    macd_val = macd_line[-1]
    sig_val = signal_line[-1]
    histogram = macd_val - sig_val
    return round(macd_val, 4), round(sig_val, 4), round(histogram, 4)


def calc_bollinger_position(closes: list[float], period: int = 20) -> Optional[float]:
    """
    Where is the current price relative to its Bollinger Band?
    Returns percentage position: 0 = lower band, 50 = midline, 100 = upper band.
    """
    if len(closes) < period:
        return None
    window = closes[-period:]
    sma = sum(window) / period
    variance = sum((x - sma) ** 2 for x in window) / period
    std = variance ** 0.5
    if std == 0:
        return 50.0
    upper = sma + 2 * std
    lower = sma - 2 * std
    price = closes[-1]
    band_range = upper - lower
    if band_range == 0:
        return 50.0
    pct = (price - lower) / band_range * 100
    return round(max(0.0, min(100.0, pct)), 2)


def calc_52w_position(price: float, low_52w: float, high_52w: float) -> Optional[float]:
    """Where is price in its 52-week range? 0 = at low, 100 = at high."""
    if high_52w <= low_52w:
        return None
    pct = (price - low_52w) / (high_52w - low_52w) * 100
    return round(max(0.0, min(100.0, pct)), 2)


def calc_volume_ratio(volumes: list[float]) -> Optional[float]:
    """Today's volume vs 20-day average. >1.5 = elevated, <0.5 = quiet."""
    if len(volumes) < 2:
        return None
    avg = sum(volumes[-21:-1]) / min(20, len(volumes) - 1)
    if avg == 0:
        return None
    return round(volumes[-1] / avg, 2)
