# Contributing to Paper Trading Exchange Simulator

Welcome to the Paper Trading Exchange Simulator project! This guide will help you get started with contributing to our comprehensive paper trading platform that supports multiple exchanges, futures trading, and real-time WebSocket connections.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Adding New Exchanges](#adding-new-exchanges)
- [Development Guidelines](#development-guidelines)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Code Standards](#code-standards)
- [Debugging and Monitoring](#debugging-and-monitoring)

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** ≥ 18
- **MongoDB** (running instance)
- **Redis** (running instance)
- **npm** or **yarn**

### Development Setup

1. **Clone and Install**

```bash
git clone <repository-url>
cd paper-trading-sh
npm install
```

2. **Environment Configuration**

Copy the sample environment file and configure it:

```bash
cp .env.sample .env
```

Configure the following essential variables in your `.env` file:

```bash
# Database Configuration
MONGO_DB_USERNAME=your_username
MONGO_DB_PASSWORD=your_password
MONGO_DB_NAME=paper_trading
MONGO_DB_HOST=localhost
MONGO_DB_PORT=27017

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Application
APP_PORT=3000

# External Services
EXCHANGE_SERVICE_API_URL=http://localhost:7507
```

3. **Start Development Environment**

```bash
# Start in development mode with hot reload
npm run start:dev

# Or start normally
npm run start

# For production
npm run build
npm run start:prod
```

4. **Verify Setup**

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Test basic functionality:

```bash
# Get latest price
curl "http://localhost:3000/exchange/latestPrice?symbol=BTCUSDT&exchange=binance"
```

## Project Architecture

The Paper Trading Simulator is built using **NestJS** and follows a modular architecture:

```
src/
├── app.module.ts           # Main application module
├── config/                 # Configuration service
├── exchange/              # Exchange integrations and services
│   ├── abstractExchange.ts # Abstract exchange interface
│   ├── exchange.service.ts # Exchange service implementation
│   └── types.ts           # Exchange-related types
├── order/                 # Order processing and management
│   ├── order.service.ts   # Core order logic
│   ├── order.controller.ts # Order API endpoints
│   └── utils.ts          # Order utilities
├── user/                  # User management and balances
├── ws/                   # WebSocket gateway for real-time updates
├── schema/               # MongoDB schemas
│   ├── order.schema.ts   # Order data model
│   ├── positions.schema.ts # Futures positions
│   ├── user.schema.ts    # User accounts
│   └── symbol.schema.ts  # Exchange symbols
├── utils/                # Shared utilities
│   ├── mutex.ts         # Thread safety utilities
│   ├── redis.ts         # Redis client wrapper
│   └── math.ts         # Mathematical utilities
└── health/               # Health check endpoints
```

### Key Components

- **Exchange Module**: Handles market data and exchange integrations
- **Order Module**: Processes spot and futures orders with complex matching logic
- **User Module**: Manages user accounts and balances
- **WebSocket Gateway**: Provides real-time updates to connected clients
- **Redis Integration**: Handles real-time ticker data and caching
- **MongoDB Schemas**: Persistent data storage with proper indexing

## Adding New Exchanges

All exchanges must extend the `AbstractExchange` class and implement the required interface methods.

### 1. Implement Exchange Interface

Create a new exchange class that extends `AbstractExchange`:

```typescript
// src/exchange/implementations/newExchange.ts
import AbstractExchange from '../abstractExchange'
import { BaseReturn, ExchangeInfo, CandleResponse, /* other types */ } from '../types'

export class NewExchangeConnector extends AbstractExchange {
  async latestPrice(symbol: string): Promise<BaseReturn<number>> {
    try {
      // Implement API call to get latest price
      const response = await fetch(`${this.baseUrl}/ticker/price?symbol=${symbol}`)
      const data = await response.json()
      
      return {
        status: StatusEnum.ok,
        data: parseFloat(data.price),
        reason: null
      }
    } catch (error) {
      return this.returnBad()(error)
    }
  }

  async getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>> {
    try {
      // Implement exchange info retrieval
      const response = await fetch(`${this.baseUrl}/exchangeInfo`)
      const data = await response.json()
      
      const symbolInfo = data.symbols.find(s => s.symbol === symbol)
      
      return {
        status: StatusEnum.ok,
        data: {
          baseAsset: { name: symbolInfo.baseAsset, minAmount: symbolInfo.minQty },
          quoteAsset: { name: symbolInfo.quoteAsset, minAmount: symbolInfo.minQuoteQty },
          priceAssetPrecision: this.getPricePrecision(symbolInfo.tickSize),
          priceMultiplier: symbolInfo.tickSize,
          maxOrders: symbolInfo.maxNumOrders
        },
        reason: null
      }
    } catch (error) {
      return this.returnBad()(error)
    }
  }

  // Implement other required methods...
  async getAllExchangeInfo(): Promise<BaseReturn<(ExchangeInfo & { pair: string })[]>> { /* ... */ }
  async getCandles(/* params */): Promise<BaseReturn<CandleResponse[]>> { /* ... */ }
  async getTrades(/* params */): Promise<BaseReturn<TradeResponse[]>> { /* ... */ }
  async getAllPrices(): Promise<BaseReturn<AllPricesResponse[]>> { /* ... */ }
}
```

### 2. Register Exchange in Types

Add your exchange to the `ExchangeEnum` in `src/exchange/types.ts`:

```typescript
export enum ExchangeEnum {
  // Existing exchanges...
  binance = 'binance',
  bybit = 'bybit',
  kucoin = 'kucoin',
  
  // Add your new exchange
  newExchange = 'newExchange',
  newExchangeUsdm = 'newExchangeUsdm',  // If futures supported
  
  // Paper trading versions
  paperNewExchange = 'paperNewExchange',
}
```

### 3. Update Exchange Factory

Modify `src/exchange/exchange.ts` to include your new exchange:

```typescript
import { NewExchangeConnector } from './implementations/newExchange'

export default class Exchange extends AbstractExchange {
  private getExchangeConnector(): AbstractExchange {
    switch (this.exchange) {
      case ExchangeEnum.binance:
        return new BinanceConnector()
      case ExchangeEnum.newExchange:
        return new NewExchangeConnector()
      default:
        throw new Error(`Unsupported exchange: ${this.exchange}`)
    }
  }
}
```

### 4. Add Exchange Utilities

Update utility functions in `src/exchange/utils.ts` if needed:

```typescript
export function isFutures(exchange: ExchangeEnum): boolean {
  return [
    ExchangeEnum.binanceUsdm,
    ExchangeEnum.newExchangeUsdm, // Add if futures supported
    // ... other futures exchanges
  ].includes(exchange)
}
```

### 5. Update Fee Structure

Add fee configuration in `src/exchange/types.ts`:

```typescript
// Add exchange-specific fees
export const newExchangeMakerFee = 0.001 // 0.1%
export const newExchangeTakerFee = 0.002 // 0.2%
```

### 6. Testing Your Exchange

Create comprehensive tests for your exchange implementation:

```typescript
// tests/exchange/newExchange.spec.ts
describe('NewExchange', () => {
  let exchange: NewExchangeConnector

  beforeEach(() => {
    exchange = new NewExchangeConnector()
  })

  it('should get latest price', async () => {
    const result = await exchange.latestPrice('BTCUSDT')
    expect(result.status).toBe(StatusEnum.ok)
    expect(result.data).toBeGreaterThan(0)
  })

  it('should get exchange info', async () => {
    const result = await exchange.getExchangeInfo('BTCUSDT')
    expect(result.status).toBe(StatusEnum.ok)
    expect(result.data.baseAsset.name).toBe('BTC')
    expect(result.data.quoteAsset.name).toBe('USDT')
  })

  // Add more tests for all interface methods
})
```

## Development Guidelines

### Code Organization

1. **Modular Structure**: Follow NestJS module patterns
2. **Separation of Concerns**: Keep exchange logic separate from order processing
3. **Error Handling**: Use consistent error handling patterns with proper HTTP status codes
4. **Async/Await**: Use modern async patterns, avoid callbacks
5. **Type Safety**: Maintain strict TypeScript typing

### Database Patterns

1. **Schema Design**: Use proper MongoDB indexes for performance
2. **Data Consistency**: Implement atomic operations for critical updates
3. **Migration Support**: Document schema changes and provide migration scripts

### WebSocket Integration

1. **Real-time Updates**: Ensure proper event emission for order and balance changes
2. **Connection Management**: Handle WebSocket disconnections gracefully
3. **Rate Limiting**: Implement proper rate limiting for WebSocket messages

### Error Handling

```typescript
// Standard error handling pattern
try {
  const result = await someOperation()
  return {
    status: StatusEnum.ok,
    data: result,
    reason: null
  }
} catch (error) {
  Logger.error('Operation failed', error)
  return this.returnBad()(error)
}
```

### Mutex Usage

Use proper locking for concurrent operations:

```typescript
@IdMute(CreateOrderMutex, (order: CreateOrderDto) => `${order.key}-${order.symbol}`)
async createOrder(order: CreateOrderDto): Promise<CreateOrderResponse> {
  // Thread-safe order creation logic
}
```

## Testing

### Unit Tests

Run unit tests for individual components:

```bash
npm run test
```

### Integration Tests

Test complete workflows:

```bash
npm run test:e2e
```

### Manual Testing

Test API endpoints manually:

```bash
# Create an order
curl -X POST "http://localhost:3000/order" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "test_key",
    "secret": "test_secret",
    "symbol": "BTCUSDT",
    "amount": 0.001,
    "price": 50000,
    "side": "BUY",
    "type": "LIMIT",
    "exchange": "binance",
    "externalId": "test_order_1"
  }'

# Check order status
curl "http://localhost:3000/order?symbol=BTCUSDT&key=test_key&secret=test_secret"
```

### WebSocket Testing

Test real-time functionality using WebSocket clients or browser developer tools.

## Pull Request Process

### Before Creating a PR

1. **Code Quality**

```bash
# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

2. **Testing**

```bash
# Run all tests
npm run test
npm run test:e2e

# Test specific functionality
npm run test -- --grep "OrderService"
```

3. **Build Verification**

```bash
npm run build
```

### PR Requirements

1. **Branch Naming**: Use descriptive branch names
   - `feature/add-kraken-exchange`
   - `fix/order-matching-bug`
   - `refactor/database-optimization`

2. **Commit Messages**: Follow conventional commits
   - `feat: add Kraken exchange support`
   - `fix: resolve order matching race condition`
   - `refactor: optimize database queries`

3. **PR Description**: Include:
   - **What**: Brief description of changes
   - **Why**: Reason for the changes
   - **Testing**: How the changes were tested
   - **Breaking Changes**: Any API or behavior changes

4. **Code Review**: Address all reviewer feedback before merging

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Tests added for new functionality
- [ ] All existing tests pass
- [ ] Documentation updated if needed
- [ ] No console.log statements in production code
- [ ] Proper error handling implemented
- [ ] Database migrations included if schema changes

## Code Standards

### TypeScript Guidelines

1. **Strict Typing**: No `any` types unless absolutely necessary
2. **Interface Definition**: Use interfaces for complex types
3. **Enum Usage**: Use enums for constants and status values
4. **Null Safety**: Handle null/undefined values explicitly

```typescript
// Good
interface OrderRequest {
  symbol: string
  amount: number
  price: number
  side: OrderSide
  type: OrderType
  exchange: ExchangeEnum
}

// Avoid
const createOrder = (data: any) => { /* ... */ }
```

### NestJS Patterns

1. **Dependency Injection**: Use proper DI patterns
2. **Module Organization**: Keep modules focused and cohesive
3. **Guards and Interceptors**: Use for cross-cutting concerns
4. **Validation**: Use class-validator for input validation

```typescript
// Example controller with validation
@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  async createOrder(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.createOrder(createOrderDto)
  }
}
```

### Database Best Practices

1. **Index Usage**: Create appropriate indexes for queries
2. **Connection Management**: Use connection pooling
3. **Transaction Usage**: Use transactions for multi-document operations
4. **Schema Validation**: Define proper mongoose schemas with validation

### Security Considerations

1. **Input Validation**: Validate all user inputs
2. **API Key Protection**: Never log API keys or secrets
3. **Rate Limiting**: Implement proper rate limiting
4. **Authentication**: Secure all endpoints appropriately

## Debugging and Monitoring

### Logging

Use structured logging throughout the application:

```typescript
import { Logger } from '@nestjs/common'

// Class-level logger
private readonly logger = new Logger(OrderService.name)

// Usage
this.logger.log('Processing order', { orderId, userId, symbol })
this.logger.error('Order processing failed', error)
this.logger.warn('Insufficient balance', { required, available })
```

### Performance Monitoring

1. **Database Queries**: Monitor slow queries and optimize indexes
2. **Memory Usage**: Watch for memory leaks in long-running processes
3. **WebSocket Connections**: Monitor connection counts and message rates
4. **Redis Usage**: Monitor Redis memory and connection usage

### Health Checks

The application includes health check endpoints:

```bash
# Basic health check
curl http://localhost:3000/health

# Detailed health status
curl http://localhost:3000/health/detailed
```

### Development Tools

1. **MongoDB Compass**: For database inspection and query optimization
2. **Redis CLI**: For cache inspection and debugging
3. **Postman/Insomnia**: For API testing
4. **WebSocket Client**: For real-time testing

### Common Issues and Solutions

1. **MongoDB Connection Issues**
   - Check connection string format
   - Verify database credentials
   - Ensure MongoDB is running

2. **Redis Connection Problems**
   - Verify Redis server status
   - Check Redis password configuration
   - Monitor Redis memory usage

3. **WebSocket Connection Drops**
   - Check network stability
   - Implement proper reconnection logic
   - Monitor server resources

4. **Order Processing Delays**
   - Check ticker data freshness
   - Monitor mutex contention
   - Verify Redis pub/sub functionality

Thank you for contributing to the Paper Trading Exchange Simulator! Your contributions help make cryptocurrency trading simulation more accessible and reliable for developers worldwide.