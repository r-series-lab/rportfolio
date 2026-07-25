import { describe, expect, it } from "vitest";
import { emptyAccountStore } from "./accounts";
import { emptyPerformanceLedger } from "./performance-ledger";
import type { PortfolioValuationSettings } from "./portfolio-valuation";
import {
  applyStatementImport,
  emptyStatementImportLedger,
  parseStatementCsv,
  type StatementImportState,
} from "./statement-import";

const valuation: PortfolioValuationSettings = { baseCurrency: "CNY", usdCnyRate: 7.1, fxAsOf: "2026-07-16", fxSource: "manual" };

function emptyState(): StatementImportState {
  return {
    accountStore: emptyAccountStore(),
    holdings: [],
    trades: [],
    performanceLedger: emptyPerformanceLedger(),
    importLedger: emptyStatementImportLedger(),
  };
}

describe("statement import", () => {
  it("parses quoted Chinese aliases into canonical rows", () => {
    const preview = parseStatementCsv([
      "记录类型,流水号,账户名称,账户编号,币种,日期,证券代码,证券名称,数量,成交价,手续费,方向",
      '成交,"流水,001",美元账户,US-1,USD,2026-07-16,AAPL,"Apple, Inc.",2,210,1.5,买入',
    ].join("\n"), "账单.csv", valuation, new Date("2026-07-16T10:00:00Z"));

    expect(preview.canApply).toBe(true);
    expect(preview.rows[0].type).toBe("trade");
    expect(preview.rows[0].externalId).toBe("流水,001");
    expect(preview.rows[0].name).toBe("Apple, Inc.");
    expect(preview.rows[0].side).toBe("buy");
  });

  it("blocks unsupported currencies and malformed rows", () => {
    const preview = parseStatementCsv("record_type,account_name,currency,date\nCASH_FLOW,欧元账户,EUR,wrong", "bad.csv", valuation);

    expect(preview.canApply).toBe(false);
    expect(preview.issues.some((issue) => issue.field === "currency" && issue.severity === "error")).toBe(true);
  });

  it("does not silently coerce malformed financial amounts to zero", () => {
    const preview = parseStatementCsv("record_type,account_name,currency,settled_cash\nACCOUNT,人民币账户,CNY,not-a-number", "bad-number.csv", valuation);

    expect(preview.canApply).toBe(false);
    expect(preview.issues.some((issue) => issue.field === "settled_cash")).toBe(true);
  });

  it("atomically imports accounts, positions, trades and cross-currency cash flows", () => {
    const preview = parseStatementCsv([
      "record_type,external_id,account_name,account_id,currency,date,symbol,name,asset_type,quantity,price,cost_price,fee,side,kind,amount,settled_cash,available_cash,quote_as_of,usd_cny_rate",
      "ACCOUNT,,美元账户,US-1,USD,2026-07-16,,,,,,,,,,,1000,900,,",
      "POSITION,,美元账户,US-1,USD,2026-07-16,AAPL,Apple,stock,2,210,180,,,,,,,2026-07-16,",
      "TRADE,T-1,美元账户,US-1,USD,2026-07-16,AAPL,Apple,stock,1,205,205,1,buy,,,,,,",
      ["CASH_FLOW", "F-1", "美元账户", "US-1", "USD", "2026-07-16", "", "", "", "", "", "", "", "", "deposit", "100", "", "", "", "7.1"].join(","),
    ].join("\n"), "full.csv", valuation, new Date("2026-07-16T10:00:00Z"));

    const result = applyStatementImport(preview, emptyState(), valuation);

    expect(preview.canApply).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.accountStore.accounts).toHaveLength(1);
    expect(result.holdings).toHaveLength(1);
    expect(result.trades).toHaveLength(1);
    expect(result.performanceLedger.cashFlows[0].baseAmount).toBe(710);
    expect(result.importLedger.batches).toHaveLength(1);
  });

  it("refuses an invalid batch without mutating any store", () => {
    const state = emptyState();
    const preview = parseStatementCsv("record_type,account_name,currency,date,amount,kind\nCASH_FLOW,美元账户,USD,2026-07-16,100,deposit", "missing-fx.csv", valuation);
    const result = applyStatementImport(preview, state, valuation);

    expect(result.applied).toBe(false);
    expect(result.accountStore.accounts).toEqual([]);
    expect(result.performanceLedger.cashFlows).toEqual([]);
  });

  it("blocks rows that reference an undeclared and unknown account", () => {
    const preview = parseStatementCsv("record_type,external_id,account_name,account_id,currency,date,symbol,name,quantity,price,fee,side\nTRADE,T-1,人民币账户,CN-1,CNY,2026-07-16,510300,ETF,10,4,1,buy", "orphan.csv", valuation);
    const result = applyStatementImport(preview, emptyState(), valuation);

    expect(preview.canApply).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.trades).toHaveLength(0);
  });

  it("blocks duplicate batches and keeps stable record counts", () => {
    const preview = parseStatementCsv("record_type,external_id,account_name,account_id,currency,date,symbol,name,quantity,price,fee,side,settled_cash,available_cash\nACCOUNT,,人民币账户,CN-1,CNY,2026-07-16,,,,,,,,1000\nTRADE,T-1,人民币账户,CN-1,CNY,2026-07-16,510300,ETF,10,4,1,buy,,", "trade.csv", valuation, new Date("2026-07-16T10:00:00Z"));
    const first = applyStatementImport(preview, emptyState(), valuation);
    const second = applyStatementImport(preview, first, valuation);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.trades).toHaveLength(1);
    expect(second.importLedger.batches).toHaveLength(1);
  });
});
