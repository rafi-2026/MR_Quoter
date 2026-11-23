'use strict';
import { describe, it, expect } from 'vitest';
const rateLimit = require('express-rate-limit');

describe('Rate Limiter Shield - Security & Protection Tests', () => {
  it('should initialize rate limiter with standard headers and window limits', () => {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false
    });
    expect(typeof limiter).toBe('function');
  });

  it('should allow requests below limit and block with 429 once threshold is exceeded', async () => {
    let statusCode = 200;
    let responseBody = null;

    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      handler: (req, res) => {
        res.status(429).json({ error: 'Rate limit exceeded' });
      },
      validate: { trustProxy: false, xForwardedForHeader: false }
    });

    const mockReq = {
      ip: '192.168.1.100',
      headers: {},
      path: '/api/test'
    };

    const createMockRes = () => ({
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
      send(body) {
        responseBody = body;
        return this;
      }
    });

    // Requests 1, 2, 3 should pass
    for (let i = 0; i < 3; i++) {
      let passed = false;
      const res = createMockRes();
      await limiter(mockReq, res, () => { passed = true; });
      expect(passed).toBe(true);
    }

    // Request 4 should be blocked with 429
    let passedFourth = false;
    const blockedRes = createMockRes();
    await limiter(mockReq, blockedRes, () => { passedFourth = true; });
    expect(passedFourth).toBe(false);
    expect(statusCode).toBe(429);
    expect(responseBody).toEqual({ error: 'Rate limit exceeded' });
  });

  it('should isolate limits per client IP', async () => {
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      validate: { trustProxy: false, xForwardedForHeader: false }
    });

    const createMockRes = () => ({
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      getHeader(k) { return this.headers[k]; },
      status(c) { return this; },
      send() { return this; }
    });

    const clientA = { ip: '10.0.0.1', headers: {}, path: '/api/test' };
    const clientB = { ip: '10.0.0.2', headers: {}, path: '/api/test' };

    let aPassed1 = false, aPassed2 = false, aPassed3 = false;
    let bPassed1 = false;

    await limiter(clientA, createMockRes(), () => { aPassed1 = true; });
    await limiter(clientA, createMockRes(), () => { aPassed2 = true; });
    await limiter(clientA, createMockRes(), () => { aPassed3 = true; });

    // Client A reached limit (3rd request blocked)
    expect(aPassed1).toBe(true);
    expect(aPassed2).toBe(true);
    expect(aPassed3).toBe(false);

    // Client B should still be allowed
    await limiter(clientB, createMockRes(), () => { bPassed1 = true; });
    expect(bPassed1).toBe(true);
  });
});

