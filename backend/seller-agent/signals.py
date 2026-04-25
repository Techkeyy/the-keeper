SIGNALS = [
    {
        "payload": "SIGNAL: Equity momentum detected\nEVENT: Large-cap tech breakout forming\nINTEL: Institutional accumulation detected across 3 major tech names. Options flow skewed bullish. Volume 2.3x average.\nACTION: Monitor tech sector for entry. Stop below 200-day MA.\nWINDOW: 4-6 hours before NY close\nCONFIDENCE: 82% | SOURCE: Quant Agent #3",
        "teaser": "Tech sector momentum signal. Institutional accumulation detected.",
        "tag": "trading_signal", "severity": "HIGH", "price": "0.10", "ttl": 3600
    },
    {
        "payload": "SIGNAL: Crypto momentum alert\nEVENT: BTC RSI divergence on 4H chart\nINTEL: Bullish RSI divergence confirmed. Volume increasing on up candles. Whale wallets accumulating.\nACTION: Consider long position. Target +8-12%. Stop -4%.\nWINDOW: Act within 2 hours\nCONFIDENCE: 78% | SOURCE: Quant Agent #3",
        "teaser": "BTC momentum signal. High confidence entry point detected.",
        "tag": "trading_signal", "severity": "HIGH", "price": "0.10", "ttl": 300
    },
    {
        "payload": "SIGNAL: Port congestion alert\nEVENT: Major EU port ETA delays +36-48 hours\nINTEL: Berth congestion confirmed at primary terminal. 40+ vessels queued. EU-bound container shipments affected.\nACTION: Reroute via alternative port. Notify clients of delay.\nWINDOW: 6 hours\nCONFIDENCE: 94% | SOURCE: Logistics Agent #1",
        "teaser": "Major EU port delay confirmed. Affects EU-bound shipments.",
        "tag": "logistics_alert", "severity": "HIGH", "price": "0.10", "ttl": 7200
    },
    {
        "payload": "SIGNAL: Fuel surcharge spike\nEVENT: Asia-EU corridor fuel surcharge +10-15%\nINTEL: Bunker fuel prices spiked at Singapore hub. Emergency surcharge effective next 48h.\nACTION: Lock in current rates immediately.\nWINDOW: 24-48 hours\nCONFIDENCE: 91% | SOURCE: Logistics Agent #1",
        "teaser": "Asia-EU fuel surcharge increasing. Lock in rates now.",
        "tag": "logistics_alert", "severity": "MEDIUM", "price": "0.05", "ttl": 86400
    },
    {
        "payload": "SIGNAL: XLM technical breakout\nEVENT: Stellar network activity surge\nINTEL: XLM 24h volume up significantly. Large wallet accumulation detected. Network transactions at multi-month high.\nACTION: Watch for breakout above resistance. Entry on confirmation.\nWINDOW: 30-60 minutes\nCONFIDENCE: 71% | SOURCE: On-chain Agent #5",
        "teaser": "XLM volume anomaly detected. Potential breakout forming.",
        "tag": "trading_signal", "severity": "MEDIUM", "price": "0.05", "ttl": 1800
    },
    {
        "payload": "SIGNAL: Biotech regulatory catalyst\nEVENT: FDA accelerated review — major biotech\nINTEL: Accelerated review designation granted. Phase 3 data pending. 3 biotech ETFs directly exposed.\nACTION: Monitor biotech sector pre-market. Expect volatility.\nWINDOW: 12 hours\nCONFIDENCE: 88% | SOURCE: Research Agent #2",
        "teaser": "Major FDA development. Affects biotech sector broadly.",
        "tag": "research", "severity": "CRITICAL", "price": "0.25", "ttl": 86400
    },
    {
        "payload": "SIGNAL: Severe weather — energy risk\nEVENT: Major storm threatening Gulf energy infrastructure\nINTEL: Storm intensifying. Projected impact on oil production. 20-25% of regional production affected.\nACTION: Energy sector long positions. WTI crude +3-7% expected.\nWINDOW: 48-72 hours\nCONFIDENCE: 89% | SOURCE: Weather Agent #4",
        "teaser": "Severe weather forming. Energy markets at risk.",
        "tag": "weather_alert", "severity": "CRITICAL", "price": "0.25", "ttl": 21600
    },
    {
        "payload": "SIGNAL: Crypto dominance shift\nEVENT: BTC dominance at altseason trigger level\nINTEL: BTC dominance at historical trigger. ETH/BTC ratio at key support. On-chain rotation beginning.\nACTION: Gradual rotation into large-cap alts. SOL, ETH primary targets.\nWINDOW: 48-72 hours\nCONFIDENCE: 79% | SOURCE: Quant Agent #3",
        "teaser": "BTC dominance at critical level. Altseason signal triggered.",
        "tag": "trading_signal", "severity": "HIGH", "price": "0.10", "ttl": 7200
    },
    {
        "payload": "SIGNAL: Shipping route optimization\nEVENT: Cost-saving route identified\nINTEL: Primary route fees elevated 300%+. Alternative saves 20-25% total cost. Multiple carriers already rerouting.\nACTION: Switch routing for next 7 days.\nWINDOW: 7 days\nCONFIDENCE: 86% | SOURCE: Logistics Agent #1",
        "teaser": "Route optimization available. Significant cost savings possible.",
        "tag": "logistics_alert", "severity": "LOW", "price": "0.01", "ttl": 604800
    },
    {
        "payload": "SIGNAL: Sports market intelligence\nEVENT: Key player injury — major championship\nINTEL: Starting player confirmed injured. Out of final. Official announcement expected 4-6 hours before event.\nACTION: Adjust positions before announcement.\nWINDOW: 4-6 hours\nCONFIDENCE: 97% | SOURCE: Sports Agent #6",
        "teaser": "Key player injury confirmed before major final. Markets not priced in.",
        "tag": "sports_intel", "severity": "HIGH", "price": "0.10", "ttl": 10800
    },
    {
        "payload": "SIGNAL: Regulatory intelligence\nEVENT: Major semiconductor export restrictions expected\nINTEL: Regulatory sources confirm expanded export restrictions. Multiple chip manufacturers affected.\nACTION: Reduce semiconductor exposure. Monitor chip sector ETFs.\nWINDOW: 24-48 hours\nCONFIDENCE: 74% | SOURCE: Intelligence Agent #8",
        "teaser": "Semiconductor export restrictions expanding. Supply chain impact expected.",
        "tag": "intelligence", "severity": "HIGH", "price": "0.10", "ttl": 86400
    },
    {
        "payload": "SIGNAL: DeFi ecosystem signal\nEVENT: Major blockchain TVL surge\nINTEL: DeFi TVL up 30%+. Institutional wallet accumulation detected. Network transactions at all-time high.\nACTION: Long entry on confirmation. Target +25-30%.\nWINDOW: 1-2 hours\nCONFIDENCE: 73% | SOURCE: On-chain Agent #5",
        "teaser": "DeFi ecosystem metrics bullish. Institutional activity detected.",
        "tag": "trading_signal", "severity": "MEDIUM", "price": "0.05", "ttl": 3600
    },
]
