# Changelog  
All notable changes to this project will be documented in this file.  
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] – 2025-10-03
### Fixed
- x1 leverage short position liquidation price

## [1.1.1] – 2025-10-01
### Fixed
- Subscribe symbol at limit order

## [1.1.0] – 2025-09-24
### Added
- Hyperliquid integration

## [1.0.7] - 2025-08-28
### Fixed
- Type error in addSymbols method

## [1.0.6] - 2025-07-21
### Fixed
- Wrong position leverage when open position by limit order

## [1.0.5] - 2025-07-02
### Changed
- Updated all npm dependencies to latest versions

## [1.0.4] - 2025-06-30
### Changed
- Switched to npm package manager
- Removed yarn.lock file (no longer needed with npm)

## [1.0.3] - 2025-06-27
### Added

### Changed
- Bumped dependencies versions to fix known vulnerabilities

### Fixed
- Fixed type errors
- Removed unused binance-node-api dependency

## [1.0.1] - 2025-01-26  
### Added  
- Initial public release of the **Paper Trading Exchange Simulator**.  
- Spot and futures (USDM & COIN-M) paper trading engine with limit/market orders, reduce-only support, leverage and hedge-mode.  
- Multi-exchange support: Binance, Bybit, KuCoin, OKX, Bitget (spot & futures).  
- Real-time order matching via WebSocket/Redis ticker feeds.  
- REST API for latest price, exchange info, candles, trades, order management and positions.  

### Changed  


### Fixed  

