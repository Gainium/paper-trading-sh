# Paper Trading Exchange Simulator

## Project Description

The Paper Trading Exchange Simulator is designed to mimic the functioning of real-world trading exchanges, allowing users to practice trading strategies without financial risk. The simulator supports various exchange types, trading options, and provides robust API access for integration with other platforms.

## Features

- Multi-exchange support
- Spot and futures trading
- Limit and market orders
- Leverage and hedge options
- Real-time WebSocket and REST API
- Support for multiple trading pairs

## Technology Stack

- NestJS
- TypeScript
- MongoDB
- Redis
- Socket.IO

## Installation

```bash
$ npm install
```

### Prerequisites

- Node.js ≥ 18
- MongoDB
- Redis

## Configuration

| Environment Variable         | Description                                      |
|------------------------------|--------------------------------------------------|
| MONGO_DB_USERNAME            | Username for MongoDB connection                  |
| MONGO_DB_PASSWORD            | Password for MongoDB connection                  |
| MONGO_DB_NAME                | Database name for MongoDB                        |
| MONGO_DB_HOST                | Host for MongoDB connection                      |
| MONGO_DB_PORT                | Port for MongoDB connection                      |
| APP_PORT                     | Port for the application                         |
| EXCHANGE_SERVICE_API_URL     | API URL for exchange service                     |
| REDIS_PORT                   | Port for Redis                                   |
| REDIS_HOST                   | Redis host                                       |
| REDIS_PASSWORD               | Password for Redis                               |

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Usage Examples

Retrieve the latest price:

```bash
curl -X GET "http://localhost:<APP_PORT>/exchange/latestPrice?symbol=BTC&exchange=binance"
```

Create an order:

```bash
curl -X POST "http://localhost:<APP_PORT>/order" -d '{"key":"example_key","secret":"example_secret", "symbol":"BTC", "amount":1, "type":"limit", "exchange":"binance", "side":"buy", "externalId":"example_id", "price":50000}'
```

Get open orders:

```bash
curl -X GET "http://localhost:<APP_PORT>/order?symbol=BTC&key=example_key&secret=example_secret"
```

## API Reference

### Exchange Endpoints
- `GET /exchange/latestPrice`
- `GET /exchange`
- `GET /exchange/all`
- `GET /exchange/candles`
- `GET /exchange/trades`
- `GET /exchange/prices`

### Order Endpoints
- `POST /order`
- `GET /order`
- `GET /order/:orderId`
- `GET /order/all/open`
- `DELETE /order`
- `DELETE /order/byid`

### Position Endpoints
- `GET /user/positions`

## Supported Exchanges

| Exchange ID       | Trading Types                                                |
|-------------------|--------------------------------------------------------------|
| `binance`         | Spot, USDM Futures, COINM Futures                            |
| `kucoin`          | Spot, Futures                                                |
| `bybit`           | Spot, COINM Futures, USDM Futures                            |
| `okx`             | Spot, Linear, Inverse                                        |
| `coinbase`        | Spot                                                         |
| `bitget`          | Spot, Coinm, Usdm Futures                                    |

## Contributing

- Use feature branches following naming convention `feature/your-feature-name`
- Ensure linting and formatting are correct by running `npm run lint` and `npm run format`
- Use conventional commits for commit messages
- Include tests for new features and bug fixes

## License

UNLICENSED
