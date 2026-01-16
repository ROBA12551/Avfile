const https = require("https");

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const EXCHANGE_RATE_KEY = process.env.EXCHANGE_RATE_KEY;

const ErrorMessages = {
  MISSING_KEY: "APIキーが設定されていません",
  INVALID_ACTION: "無効なアクションです",
  INVALID_SYMBOL: "シンボルが指定されていません",
  INVALID_CURRENCY: "通貨が指定されていません",
  NETWORK_ERROR: "ネットワークエラーが発生しました",
  PARSE_ERROR: "JSONパースエラーが発生しました",
  METHOD_NOT_ALLOWED: "POSTのみ対応しています",
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data || "{}");
          } catch (e) {
            return reject(new Error(`${ErrorMessages.PARSE_ERROR}: ${e.message}`));
          }

          // ★ 上流のHTTPエラーを拾う
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              parsed?.error ||
              parsed?.message ||
              `Upstream HTTP ${res.statusCode}`;
            const err = new Error(msg);
            err.statusCode = 502;
            return reject(err);
          }

          resolve(parsed);
        });
      })
      .on("error", (err) => {
        const e = new Error(`${ErrorMessages.NETWORK_ERROR}: ${err.message}`);
        e.statusCode = 502;
        reject(e);
      });
  });
}

function parseEventBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (e) {
    const err = new Error(`リクエストボディのパースに失敗しました: ${e.message}`);
    err.statusCode = 400;
    throw err;
  }
}

function requireKey(name, value) {
  if (!value) {
    const err = new Error(`${ErrorMessages.MISSING_KEY}: ${name}`);
    err.statusCode = 500;
    throw err;
  }
}

async function getStockQuote(symbol) {
  requireKey("FINNHUB_KEY", FINNHUB_KEY);
  if (!symbol || typeof symbol !== "string") {
    const err = new Error(ErrorMessages.INVALID_SYMBOL);
    err.statusCode = 400;
    throw err;
  }
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    symbol
  )}&token=${encodeURIComponent(FINNHUB_KEY)}`;
  return await fetchJSON(url);
}

async function getStockCandles(symbol, resolution, from, to) {
  requireKey("FINNHUB_KEY", FINNHUB_KEY);
  if (!symbol || typeof symbol !== "string") {
    const err = new Error(ErrorMessages.INVALID_SYMBOL);
    err.statusCode = 400;
    throw err;
  }
  if (!resolution || !from || !to) {
    const err = new Error("resolution, from, toは必須です");
    err.statusCode = 400;
    throw err;
  }

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
    symbol
  )}&resolution=${encodeURIComponent(resolution)}&from=${encodeURIComponent(
    from
  )}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
  return await fetchJSON(url);
}

async function getCompanyProfile(symbol) {
  requireKey("FINNHUB_KEY", FINNHUB_KEY);
  if (!symbol || typeof symbol !== "string") {
    const err = new Error(ErrorMessages.INVALID_SYMBOL);
    err.statusCode = 400;
    throw err;
  }
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(
    symbol
  )}&token=${encodeURIComponent(FINNHUB_KEY)}`;
  return await fetchJSON(url);
}

async function getExchangeRate(fromCurrency, toCurrency) {
  requireKey("EXCHANGE_RATE_KEY", EXCHANGE_RATE_KEY);
  if (!fromCurrency || typeof fromCurrency !== "string") {
    const err = new Error("fromCurrencyが指定されていません");
    err.statusCode = 400;
    throw err;
  }
  if (!toCurrency || typeof toCurrency !== "string") {
    const err = new Error("toCurrencyが指定されていません");
    err.statusCode = 400;
    throw err;
  }

  const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(
    EXCHANGE_RATE_KEY
  )}/latest/${encodeURIComponent(fromCurrency)}`;

  const data = await fetchJSON(url);
  const rate = data?.conversion_rates?.[toCurrency];
  if (!rate) {
    const err = new Error(`Rate not found: ${toCurrency}`);
    err.statusCode = 502;
    throw err;
  }
  return { base: fromCurrency, target: toCurrency, rate };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders(),
        body: JSON.stringify({ error: ErrorMessages.METHOD_NOT_ALLOWED }),
      };
    }

    const { action, symbol, resolution, from, to, fromCurrency, toCurrency } =
      parseEventBody(event);

    if (!action || typeof action !== "string") {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: ErrorMessages.INVALID_ACTION }),
      };
    }

    let result;
    switch (action) {
      case "quote":
        result = await getStockQuote(symbol);
        break;
      case "candles":
        result = await getStockCandles(symbol, resolution, from, to);
        break;
      case "profile":
        result = await getCompanyProfile(symbol);
        break;
      case "exchange":
        result = await getExchangeRate(fromCurrency, toCurrency);
        break;
      default:
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `不正なアクション: ${action}` }),
        };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: error.statusCode || 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
