# 🧺 PolyBaskets

**ETF for prediction markets - A prediction market aggregator that lets you bundle multiple Polymarket outcomes into one basket, set custom weights and bet as a single position — a portfolio in one trade**

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen)](https://polybaskets-production.up.railway.app/)
[![Vara Network](https://img.shields.io/badge/Powered%20by-Vara%20Network-purple)](https://vara.network)

---

## 🎯 The Problem

**Prediction markets are fragmented and limited:**

- Users can only bet on **individual markets** one at a time
- No way to create **diversified positions** across multiple outcomes
- Managing multiple bets is **complex and time-consuming**
- No mechanism to bet on **correlated events** as a single position
- Missing the concept of **index-based investing** in predictions

**Example:** You believe tech stocks will boom, AI regulation will pass, and crypto will rally. Currently, you'd need to place 3+ separate bets, track each one, and manage payouts individually.

---

## 💡 The Solution

**PolyBaskets** lets you create **prediction market baskets** - curated collections of Polymarket outcomes with custom weights, all settled as a single on-chain position.

---

## 🔄 How It Works

```mermaid
flowchart TD
    subgraph Data["📊 DATA SOURCE"]
        PM[("Polymarket API")]
        PM --> |Live Prices| MARKETS["Active Markets\n• BTC $100k?\n• Trump 2024?\n• AI Regulation?"]
    end
    
    subgraph Create["🧺 BASKET CREATION"]
        MARKETS --> SELECT["Select Markets"]
        SELECT --> WEIGHT["Assign Weights\n40% / 35% / 25%"]
        WEIGHT --> INDEX["Calculate Index\nΣ(Weight × Probability)"]
        INDEX --> |"Entry Index: 85.7%"| SAVE["Save & Bet"]
    end
    
    subgraph Chain["⛓️ VARA NETWORK"]
        SAVE --> |"100 VARA"| CONTRACT[("Smart Contract")]
        CONTRACT --> BASKET["Basket Created\n• ID: #42\n• Entry: 0.857\n• Shares: 100"]
        CONTRACT --> POSITION["Position Stored\n• User Address\n• Shares Owned"]
    end
    
    subgraph Settle["🤖 SETTLEMENT"]
        BOT["Settler Bot"] --> |Monitor| PM
        PM --> |"Market Resolved"| BOT
        BOT --> |"Propose Settlement"| CONTRACT
        CONTRACT --> CHALLENGE["12min Challenge\nWindow"]
        CHALLENGE --> FINALIZE["Finalized\nSettlement Index: 1.0"]
    end
    
    subgraph Claim["💰 PAYOUT"]
        FINALIZE --> CALC["Calculate Payout\n100 × (1.0 ÷ 0.857)"]
        CALC --> PAYOUT["Claim 116.7 VARA\n+16.7% Profit"]
    end
    
    style PM fill:#6366f1,color:#fff
    style CONTRACT fill:#8b5cf6,color:#fff
    style BOT fill:#10b981,color:#fff
    style PAYOUT fill:#22c55e,color:#fff
```

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph Frontend["🖥️ FRONTEND (React + Vite)"]
        UI["Web Interface"]
        WALLET["Wallet Connection\nSubWallet / Talisman"]
        STATE["State Management\nReact Query + Context"]
    end
    
    subgraph External["🌐 EXTERNAL SERVICES"]
        POLY["Polymarket\nGamma API"]
        VARA_RPC["Vara Network\nRPC Node"]
    end
    
    subgraph Backend["⚙️ BACKEND SERVICES"]
        SETTLER["Settler Bot\nNode.js"]
        PROXY["API Proxy\nCORS Handler"]
    end
    
    subgraph Blockchain["⛓️ VARA NETWORK"]
        PROGRAM["Smart Contract\nRust / Sails"]
        STORAGE["On-Chain Storage\n• Baskets\n• Positions\n• Settlements"]
    end
    
    UI <--> WALLET
    UI <--> STATE
    STATE <--> |"REST API"| POLY
    STATE <--> |"WebSocket"| VARA_RPC
    WALLET <--> |"Sign TX"| VARA_RPC
    VARA_RPC <--> PROGRAM
    PROGRAM <--> STORAGE
    SETTLER <--> |"Monitor"| POLY
    SETTLER <--> |"Settle TX"| VARA_RPC
    PROXY <--> POLY
    UI <--> PROXY
    
    style Frontend fill:#1e293b,color:#fff
    style Blockchain fill:#7c3aed,color:#fff
    style Backend fill:#059669,color:#fff
    style External fill:#0891b2,color:#fff
```

---

## 📋 User Flow Sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant F as 🖥️ Frontend
    participant P as 📊 Polymarket
    participant V as ⛓️ Vara Contract
    participant B as 🤖 Settler Bot

    rect rgb(30, 41, 59)
        Note over U,P: BASKET CREATION
        U->>F: Browse Markets
        F->>P: Fetch Live Prices
        P-->>F: Market Data + Probabilities
        F-->>U: Display Markets
        U->>F: Select Markets + Set Weights
        F->>F: Calculate Basket Index
        U->>F: Confirm & Sign Transaction
        F->>V: CreateBasket(items, weights)
        F->>V: BetOnBasket(basketId, indexBps)
        V-->>F: Position Created (100 shares)
        F-->>U: Success! Basket #42 Created
    end

    rect rgb(20, 83, 45)
        Note over P,B: MARKET RESOLUTION
        loop Every 5 minutes
            B->>P: Check Market Status
            P-->>B: Market Resolved (YES won)
        end
        B->>B: All markets in basket resolved
        B->>V: ProposeSettlement(basketId, resolutions)
        V-->>V: Start 12min Challenge Window
    end

    rect rgb(127, 29, 29)
        Note over V,B: FINALIZATION
        B->>B: Wait 12 minutes
        B->>V: FinalizeSettlement(basketId)
        V-->>V: Settlement Finalized
    end

    rect rgb(21, 94, 117)
        Note over U,V: CLAIM PAYOUT
        U->>F: View Basket Status
        F->>V: GetSettlement(basketId)
        V-->>F: Settlement Index: 1.0
        F-->>U: Show Claim Button
        U->>F: Click "Claim Payout"
        F->>V: Claim(basketId)
        V->>V: Calculate: 100 × (1.0 ÷ 0.857)
        V-->>U: Transfer 116.7 VARA
        F-->>U: 🎉 Payout Celebration Modal
    end
```

---

## 🧩 Component Architecture

```mermaid
flowchart LR
    subgraph Pages["📄 Pages"]
        BP["BuilderPage"]
        BKP["BasketPage"]
        EP["ExplorePage"]
        MBP["MyBasketsPage"]
    end
    
    subgraph Components["🧱 Components"]
        BB["BasketBuilder"]
        BC["BasketCard"]
        BI["BasketIndex"]
        MS["MarketSearch"]
        SB["SaveBasketButton"]
        PC["PayoutCelebration"]
    end
    
    subgraph Lib["📚 Libraries"]
        PM["polymarket.ts\nAPI Client"]
        BU["basket-utils.ts\nIndex Calc"]
        BO["basket-onchain.ts\nContract Client"]
    end
    
    subgraph Context["🔄 Context"]
        WC["WalletContext"]
        BC2["BasketContext"]
    end
    
    BP --> BB
    BP --> MS
    BP --> SB
    BKP --> BI
    BKP --> PC
    EP --> MS
    MBP --> BC
    
    BB --> BU
    SB --> BO
    BI --> PM
    MS --> PM
    
    SB --> WC
    BB --> BC2
    
    style Pages fill:#3b82f6,color:#fff
    style Components fill:#8b5cf6,color:#fff
    style Lib fill:#10b981,color:#fff
    style Context fill:#f59e0b,color:#fff
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔴 **Live Data** | Real-time prices from Polymarket API, updates every 2 seconds |
| 🧺 **Basket Creation** | Select multiple markets, assign custom weights (must total 100%) |
| ⛓️ **On-Chain Settlement** | Trustless settlement with 12-min challenge window |
| 📊 **Portfolio Tracking** | Track all baskets, live P&L, claim with one click |
| 🎉 **Share Wins** | Download image, share on X (Twitter) and Telegram |

---

## 📈 Index Calculation

```mermaid
flowchart LR
    subgraph Markets["Selected Markets"]
        M1["BTC $100k\nYES @ 75%"]
        M2["Trump 2024\nYES @ 52%"]
        M3["AI Regulation\nNO @ 60%"]
    end
    
    subgraph Weights["Assigned Weights"]
        W1["40%"]
        W2["35%"]
        W3["25%"]
    end
    
    subgraph Calc["Calculation"]
        C1["0.40 × 0.75 = 0.300"]
        C2["0.35 × 0.52 = 0.182"]
        C3["0.25 × 0.60 = 0.150"]
    end
    
    subgraph Result["Result"]
        R["Index = 0.632\n(63.2%)"]
    end
    
    M1 --> W1 --> C1
    M2 --> W2 --> C2
    M3 --> W3 --> C3
    C1 --> R
    C2 --> R
    C3 --> R
    
    style Result fill:#22c55e,color:#fff
```

**Formula:** `Index = Σ (Weight × Probability)`

---

## 💰 Payout Formula

```
Payout = Shares × (Settlement Index ÷ Entry Index)
```

| Scenario | Entry | Settlement | Bet | Payout | Result |
|----------|-------|------------|-----|--------|--------|
| 📈 **Profit** | 63.2% | 85% | 100 VARA | 134.5 VARA | +34.5% |
| 📉 **Loss** | 63.2% | 40% | 100 VARA | 63.3 VARA | -36.7% |

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/Adityaakr/polybaskets.git
cd polybaskets

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Variables

```env
VITE_PROGRAM_ID=0x36cbc8f30e84f2a3fbf60655175fb0673aedba686299fafbcbd9659df6c20577
VITE_VARA_NODE_ADDRESS=wss://testnet.vara.network
VITE_GAMMA_PROXY=/gamma
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React, TypeScript, Vite, TailwindCSS, shadcn/ui |
| **Blockchain** | Vara Network (Gear Protocol) |
| **Smart Contract** | Rust with Sails framework |
| **Data Source** | Polymarket Gamma API |
| **State** | React Query, Context API |

---

## 📁 Project Structure

```
polybaskets/
├── src/                      # React frontend
│   ├── components/           # UI components
│   ├── pages/                # Route pages
│   ├── lib/                  # Utilities & API clients
│   └── contexts/             # React contexts
├── settler-bot/              # Settlement automation
├── program/                  # Vara smart contract (Rust)
└── public/                   # Static assets & IDL
```

---

## 🔗 Links

- **Live App:** [polybaskets.xyz](https://polybaskets.xyz)
- **Vara Network:** [vara.network](https://vara.network)
- **Polymarket:** [polymarket.com](https://polymarket.com)

---

## 📄 License

MIT License - feel free to fork and build!

---

<p align="center">
  <b>🧺 Build your prediction portfolio. Bet on the future.</b>
</p>
