import type { HoldingRecord } from "./holdings";
import type { MarketAnalysisReport } from "./types";
import type { OrderIntent, ReplacementOrderLink } from "./strategy-engine";
import { formatPercent } from "./utils";
import { chinaInstrumentKind, isT0ChinaInstrument, simulateAShareFill, type AShareFeeBreakdown } from "./a-share-sim";
import { chinaTradingCalendarNote, isChinaTradingDay, nextChinaTradingDay } from "./china-trading-calendar";
import {
  DEFAULT_FUND_EXECUTION_POLICY,
  fundFeesFor,
  fundOrderScheduleFor,
  normalizeFundExecutionPolicy,
} from "./fund-execution-policy";
import {
  activatePaperSimState,
  firstPositiveNumber,
  markPaperPosition,
  MAX_PAPER_SIM_SNAPSHOTS,
  MAX_PAPER_SIM_TRADES,
  normalizePaperSimState,
  paperFundOrderNextDate,
  paperFundOrderStatusLabel,
  pendingFundOrderValue,
  summarizePaperSimState,
  symbolKey,
  type PaperSimPendingFundOrder,
  type PaperSimPosition,
  type PaperSimRunResult,
  type PaperSimSnapshot,
  type PaperSimState,
  type PaperSimTrade,
  type RunPaperSimInput,
} from "./paper-sim";

type PaperSimTradeContext = {
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
};

const PAPER_SIM_FEE_RATE = 0.001;

const PAPER_SIM_SLIPPAGE_RATE = 0.002;

export function runPaperSimulationDay({
  fundExecutionPolicy = DEFAULT_FUND_EXECUTION_POLICY,
  fundNavEvidence = [],
  holdings,
  orderIntents,
  positionPlan,
  preset,
  report,
  source,
  state,
  strategy,
}: RunPaperSimInput): PaperSimRunResult {
  const normalizedFundPolicy = normalizeFundExecutionPolicy(fundExecutionPolicy);
  const seeded = activatePaperSimState(state, { holdings, positionPlan, preset, report, strategy });
  const tradeContext: PaperSimTradeContext = {
    profileKey: report.profileKey || seeded.profileKey,
    profileName: report.profileName || seeded.profileName,
    strategyKey: strategy.key || seeded.strategyKey,
    strategyName: strategy.label || seeded.strategyName,
  };
  const runDate = report.asOf || new Date().toISOString().slice(0, 10);
  const chinaProfile = report.profileMarket.toLowerCase() === "cn";
  if (chinaProfile && !isChinaTradingDay(runDate)) {
    const reason = `${runDate} 非 A 股交易日（${chinaTradingCalendarNote(runDate)}），不生成成交或净值快照。`;
    const closedState = normalizePaperSimState({
      ...seeded,
      updatedAt: new Date().toISOString(),
      nextRunHint: `下个交易日 ${nextChinaTradingDay(runDate)}`,
    });
    return {
      state: closedState,
      summary: summarizePaperSimState(closedState),
      trades: [],
      skipped: orderIntents.length,
      skipReasons: [reason],
      alreadyRan: false,
      marketClosed: true,
    };
  }
  if (seeded.lastRunDate === runDate) {
    const summary = summarizePaperSimState(seeded);
    return { state: seeded, summary, trades: [], skipped: 0, skipReasons: [], alreadyRan: true, marketClosed: false };
  }

  const prices = referencePricesFor({ holdings, report });
  let cash = seeded.cash;
  let skipped = 0;
  const skipReasons: string[] = [];
  const positionsBySymbol = new Map(seeded.positions.map((position) => [symbolKey(position.symbol), { ...position, availableQuantity: position.quantity }]));
  const trades: PaperSimTrade[] = [];
  const now = new Date().toISOString();
  let pendingFundOrders = seeded.pendingFundOrders.map((order) => ({ ...order }));
  const linkedOrderIntents: OrderIntent[] = [];

  pendingFundOrders.forEach((order) => {
    if (order.side !== "SELL" || order.settlementStage !== "nav-pending" || order.reservedQuantity <= 0) return;
    const current = positionsBySymbol.get(symbolKey(order.symbol));
    if (!current) return;
    current.availableQuantity = Math.max(0, current.availableQuantity - order.reservedQuantity);
  });

  const stillPending: PaperSimPendingFundOrder[] = [];
  pendingFundOrders.forEach((order, index) => {
    const key = symbolKey(order.symbol);
    const holding = holdings.find((item) => symbolKey(item.symbol) === key);

    if (order.settlementStage === "replacement-paused") {
      const replacement = order.replacementLink;
      const targetHolding = replacement
        ? holdings.find((item) => symbolKey(item.symbol) === symbolKey(replacement.targetSymbol))
        : undefined;
      if (replacement?.remainingBuyAmount && targetHolding?.fundPurchaseOpen === true) {
        linkedOrderIntents.push(nextReplacementBuyIntent(
          { ...replacement, stage: "subscribe" },
          order.targetWeight,
          targetHolding.fundPurchaseLimit,
        ));
      } else {
        stillPending.push(order);
        if (replacement?.targetSymbol) {
          skipReasons.push(`${replacement.targetSymbol}：替换任务已保留，等待目标基金恢复申购。`);
        }
      }
      return;
    }

    if (order.side === "SELL" && order.settlementStage === "cash-pending") {
      if (!order.cashCredited && order.cashArrivalDate > runDate) {
        stillPending.push(order);
        return;
      }
      const netCash = Math.max(0, order.settledGross - order.settledFee);
      if (!order.cashCredited) cash += netCash;
      const replacement = order.replacementLink;
      if (replacement?.stage === "redeem") {
        const remainingBuyAmount = Math.min(replacement.remainingBuyAmount, netCash);
        const targetHolding = holdings.find((item) => symbolKey(item.symbol) === symbolKey(replacement.targetSymbol));
        const subscribeLink: ReplacementOrderLink = {
          ...replacement,
          stage: "subscribe",
          remainingBuyAmount,
        };
        if (remainingBuyAmount > 0 && targetHolding?.fundPurchaseOpen === true) {
          linkedOrderIntents.push(nextReplacementBuyIntent(subscribeLink, order.targetWeight, targetHolding.fundPurchaseLimit));
        } else if (remainingBuyAmount > 0) {
          stillPending.push({
            ...order,
            cashCredited: true,
            replacementLink: subscribeLink,
            settlementStage: "replacement-paused",
          });
          skipReasons.push(`${replacement.targetSymbol}：赎回资金已到账，替换任务暂停；恢复申购后自动继续。`);
        }
      }
      return;
    }

    const navEvidence = fundNavEvidenceFor(holding, report, fundNavEvidence, key, order.navDate);
    const availableNav = navEvidence.asOf === order.navDate ? navEvidence.nav : null;
    const confirmedNav = firstPositiveNumber(
      order.confirmedNav,
      order.navDate <= runDate ? availableNav : null,
    ) ?? 0;
    const updatedOrder = confirmedNav === order.confirmedNav
      ? order
      : { ...order, confirmedNav, navCapturedDate: runDate, navSource: navEvidence.source };
    if (order.confirmDate > runDate) {
      stillPending.push(updatedOrder);
      return;
    }
    const confirmationNav = firstPositiveNumber(confirmedNav);
    if (!confirmationNav) {
      skipped += 1;
      skipReasons.push(`${key}：目标净值日 ${order.navDate}，当前确认净值日期 ${navEvidence.asOf || "未知"}，继续等待精确匹配。`);
      stillPending.push(updatedOrder);
      return;
    }
    if (order.side === "BUY") {
      const fee = updatedOrder.reservedCash * updatedOrder.buyFeeRate;
      const notional = Math.max(0, updatedOrder.reservedCash - fee);
      const quantity = notional / confirmationNav;
      if (quantity <= 0) {
        cash += updatedOrder.reservedCash;
        skipped += 1;
        skipReasons.push(`${key}：确认金额不足，已退回冻结现金。`);
        return;
      }
      const current = positionsBySymbol.get(key);
      const currentQuantity = current?.quantity ?? 0;
      const nextQuantity = currentQuantity + quantity;
      const currentCost = currentQuantity * (current?.avgCost ?? confirmationNav);
      positionsBySymbol.set(key, {
        symbol: key,
        name: updatedOrder.name || current?.name || key,
        currency: current?.currency || positionPlan.currency,
        quantity: nextQuantity,
        availableQuantity: (current?.availableQuantity ?? currentQuantity) + quantity,
        avgCost: (currentCost + updatedOrder.reservedCash) / nextQuantity,
        lastPrice: confirmationNav,
        marketValue: nextQuantity * confirmationNav,
        realizedPnl: current?.realizedPnl ?? 0,
        unrealizedPnl: 0,
      });
      trades.push(createFundConfirmationTrade({ fee, index, nav: confirmationNav, order: updatedOrder, quantity, realizedPnl: 0, runDate }));
      const replacement = updatedOrder.replacementLink;
      if (replacement?.stage === "subscribe" && replacement.remainingBuyAmount > 0) {
        if (holding?.fundPurchaseOpen === true) {
          linkedOrderIntents.push(nextReplacementBuyIntent(replacement, updatedOrder.targetWeight, holding.fundPurchaseLimit));
        } else {
          stillPending.push({
            ...updatedOrder,
            cashCredited: true,
            replacementLink: replacement,
            reservedCash: 0,
            settlementStage: "replacement-paused",
          });
          skipReasons.push(`${replacement.targetSymbol}：当前批已确认，剩余替换金额暂停；恢复申购后自动继续。`);
        }
      }
      return;
    }

    const current = positionsBySymbol.get(key);
    if (!current || current.quantity <= 0) {
      skipped += 1;
      skipReasons.push(`${key}：确认赎回时没有可用基金份额。`);
      return;
    }
    const quantity = Math.min(current.quantity, updatedOrder.reservedQuantity);
    const gross = quantity * confirmationNav;
    const fee = gross * updatedOrder.sellFeeRate;
    const realizedPnl = (confirmationNav - current.avgCost) * quantity - fee;
    const nextQuantity = current.quantity - quantity;
    if (nextQuantity <= 0.000001) {
      positionsBySymbol.delete(key);
    } else {
      positionsBySymbol.set(key, {
        ...current,
        quantity: nextQuantity,
        availableQuantity: Math.min(nextQuantity, current.availableQuantity),
        lastPrice: confirmationNav,
        marketValue: nextQuantity * confirmationNav,
        realizedPnl: current.realizedPnl + realizedPnl,
      });
    }
    trades.push(createFundConfirmationTrade({ fee, index, nav: confirmationNav, order: updatedOrder, quantity, realizedPnl, runDate }));
    stillPending.push({
      ...updatedOrder,
      cashCredited: false,
      confirmedNav: confirmationNav,
      settledFee: fee,
      settledGross: gross,
      settledQuantity: quantity,
      settlementStage: "cash-pending",
    });
    skipReasons.push(`${key}：赎回净值已确认，资金预计 ${updatedOrder.cashArrivalDate} 到账。`);
  });
  pendingFundOrders = stillPending;

  [...orderIntents, ...linkedOrderIntents].forEach((intent, index) => {
    const side = intent.side.toUpperCase() === "SELL" ? "SELL" : "BUY";
    const key = symbolKey(intent.symbol);
    const referencePrice = firstPositiveNumber(prices.get(key), parseOrderLimit(intent), existingPositionPrice(positionsBySymbol.get(key)));
    const requestedNotional = parseOrderAmount(intent.amount);
    if (!referencePrice || requestedNotional <= 0) {
      skipped += 1;
      return;
    }

    const holding = holdings.find((item) => symbolKey(item.symbol) === key);
    const chinaMode = report.profileMarket.toLowerCase() === "cn" || /^\d{6}$/.test(key);
    if (chinaMode) {
      const current = positionsBySymbol.get(key);
      const instrumentKind = chinaInstrumentKind(holding, key);
      if (instrumentKind === "fund") {
        const duplicate = pendingFundOrders.some((order) => order.orderKey === intent.key && order.side === side);
        if (duplicate) {
          skipped += 1;
          skipReasons.push(`${key}：同一基金委托仍在等待净值确认。`);
          return;
        }
        const feePolicy = fundFeesFor(normalizedFundPolicy, key);
        const schedule = fundOrderScheduleFor({
          cutoffTime: normalizedFundPolicy.cutoffTime,
          orderDate: runDate,
          redemptionSettlementDays: feePolicy.redemptionSettlementDays,
          submittedAt: now,
        });
        const sellFeeRate = side === "SELL" && intent.replacementLink?.stage === "redeem"
          ? intent.replacementLink.sellFeeRatePct / 100
          : feePolicy.sellFeeRate;
        const navEvidence = fundNavEvidenceFor(holding, report, fundNavEvidence, key, schedule.navDate);
        const confirmedNav = navEvidence.asOf === schedule.navDate ? navEvidence.nav : 0;
        if (side === "BUY") {
          const reservedCash = Math.min(requestedNotional, Math.max(0, cash));
          if (reservedCash <= 0) {
            skipped += 1;
            skipReasons.push(`${key}：可用现金不足，未提交基金申购。`);
            return;
          }
          cash -= reservedCash;
          pendingFundOrders.push(createPendingFundOrder({
            buyFeeRate: feePolicy.buyFeeRate,
            confirmedNav,
            cutoffTime: normalizedFundPolicy.cutoffTime,
            navCapturedDate: confirmedNav ? navEvidence.asOf : "",
            navSource: confirmedNav ? navEvidence.source : "",
            schedule,
            sellFeeRate,
            intent,
            referenceNav: referencePrice,
            requestedNotional,
            reservedCash,
            reservedQuantity: 0,
            runDate,
            side,
            source,
            tradeContext,
          }));
          return;
        }
        const requestedQuantity = requestedNotional / referencePrice;
        const reservedQuantity = Math.min(current?.availableQuantity ?? 0, requestedQuantity);
        if (!current || reservedQuantity <= 0) {
          skipped += 1;
          skipReasons.push(`${key}：没有可预约赎回的基金份额。`);
          return;
        }
        current.availableQuantity = Math.max(0, current.availableQuantity - reservedQuantity);
        pendingFundOrders.push(createPendingFundOrder({
          buyFeeRate: feePolicy.buyFeeRate,
          confirmedNav,
          cutoffTime: normalizedFundPolicy.cutoffTime,
          navCapturedDate: confirmedNav ? navEvidence.asOf : "",
          navSource: confirmedNav ? navEvidence.source : "",
          schedule,
          sellFeeRate,
          intent,
          referenceNav: referencePrice,
          requestedNotional,
          reservedCash: 0,
          reservedQuantity,
          runDate,
          side,
          source,
          tradeContext,
        }));
        return;
      }
      const change1d = report.technicalRows.find((row) => symbolKey(row.symbol) === key)?.change1d
        ?? report.assetStatuses.find((row) => symbolKey(row.symbol) === key)?.change1d
        ?? null;
      const fill = simulateAShareFill({
        availableQuantity: current?.availableQuantity ?? current?.quantity ?? 0,
        cash,
        change1d,
        currentQuantity: current?.quantity ?? 0,
        holding,
        name: intent.name || holding?.name || key,
        referencePrice,
        requestedNotional,
        side,
        symbol: key,
      });
      if (!fill.executed) {
        skipped += 1;
        skipReasons.push(`${key}：${fill.reason}`);
        return;
      }
      if (side === "BUY") {
        const currentQuantity = current?.quantity ?? 0;
        const currentCost = currentQuantity * (current?.avgCost ?? fill.executionPrice);
        const nextQuantity = currentQuantity + fill.quantity;
        const nextAvailable = (current?.availableQuantity ?? currentQuantity)
          + (isT0ChinaInstrument(fill.kind, intent.name || holding?.name || key) ? fill.quantity : 0);
        cash -= fill.notional + fill.fees.total;
        positionsBySymbol.set(key, {
          symbol: key,
          name: intent.name || current?.name || key,
          currency: current?.currency || positionPlan.currency,
          quantity: nextQuantity,
          availableQuantity: nextAvailable,
          avgCost: (currentCost + fill.notional + fill.fees.total) / nextQuantity,
          lastPrice: referencePrice,
          marketValue: nextQuantity * referencePrice,
          realizedPnl: current?.realizedPnl ?? 0,
          unrealizedPnl: 0,
        });
        trades.push(createPaperTrade({
          feeBreakdown: fill.fees,
          fee: fill.fees.total,
          index,
          intent,
          notional: fill.notional,
          price: fill.executionPrice,
          quantity: fill.quantity,
          realizedPnl: 0,
          ruleLabel: fill.ruleLabel,
          ruleNote: fill.reason,
          runDate,
          side,
          slippage: fill.slippage,
          source,
          tradeContext,
        }));
        return;
      }
      if (!current) {
        skipped += 1;
        skipReasons.push(`${key}：没有可卖持仓。`);
        return;
      }
      const realizedPnl = (fill.executionPrice - current.avgCost) * fill.quantity - fill.fees.total;
      const nextQuantity = current.quantity - fill.quantity;
      cash += fill.notional - fill.fees.total;
      if (nextQuantity <= 0.000001) {
        positionsBySymbol.delete(key);
      } else {
        positionsBySymbol.set(key, {
          ...current,
          quantity: nextQuantity,
          availableQuantity: Math.min(nextQuantity, fill.availableQuantity),
          lastPrice: referencePrice,
          marketValue: nextQuantity * referencePrice,
          realizedPnl: current.realizedPnl + realizedPnl,
        });
      }
      trades.push(createPaperTrade({
        feeBreakdown: fill.fees,
        fee: fill.fees.total,
        index,
        intent,
        notional: fill.notional,
        price: fill.executionPrice,
        quantity: fill.quantity,
        realizedPnl,
        ruleLabel: fill.ruleLabel,
        ruleNote: fill.reason,
        runDate,
        side,
        slippage: fill.slippage,
        source,
        tradeContext,
      }));
      return;
    }

    if (side === "BUY") {
      const executionPrice = referencePrice * (1 + PAPER_SIM_SLIPPAGE_RATE);
      const maxNotional = Math.max(0, cash / (1 + PAPER_SIM_FEE_RATE));
      const notional = Math.min(requestedNotional, maxNotional);
      if (notional <= 0) {
        skipped += 1;
        return;
      }
      const quantity = notional / executionPrice;
      const fee = notional * PAPER_SIM_FEE_RATE;
      const current = positionsBySymbol.get(key);
      const currentQuantity = current?.quantity ?? 0;
      const currentCost = currentQuantity * (current?.avgCost ?? executionPrice);
      const nextQuantity = currentQuantity + quantity;
      cash -= notional + fee;
      positionsBySymbol.set(key, {
        symbol: key,
        name: intent.name || current?.name || key,
        currency: current?.currency || positionPlan.currency,
        quantity: nextQuantity,
        availableQuantity: nextQuantity,
        avgCost: nextQuantity > 0 ? (currentCost + notional + fee) / nextQuantity : executionPrice,
        lastPrice: referencePrice,
        marketValue: nextQuantity * referencePrice,
        realizedPnl: current?.realizedPnl ?? 0,
        unrealizedPnl: 0,
      });
      trades.push(createPaperTrade({ fee, index, intent, notional, price: executionPrice, quantity, realizedPnl: 0, runDate, side, source, tradeContext }));
      return;
    }

    const current = positionsBySymbol.get(key);
    if (!current || current.quantity <= 0) {
      skipped += 1;
      return;
    }
    const executionPrice = referencePrice * (1 - PAPER_SIM_SLIPPAGE_RATE);
    const requestedQuantity = requestedNotional / executionPrice;
    const quantity = Math.min(current.quantity, requestedQuantity > 0 ? requestedQuantity : current.quantity);
    if (quantity <= 0) {
      skipped += 1;
      return;
    }
    const notional = quantity * executionPrice;
    const fee = notional * PAPER_SIM_FEE_RATE;
    const realizedPnl = (executionPrice - current.avgCost) * quantity - fee;
    const nextQuantity = current.quantity - quantity;
    cash += notional - fee;
    if (nextQuantity <= 0.000001) {
      positionsBySymbol.delete(key);
    } else {
      positionsBySymbol.set(key, {
        ...current,
        quantity: nextQuantity,
        availableQuantity: nextQuantity,
        lastPrice: referencePrice,
        marketValue: nextQuantity * referencePrice,
        realizedPnl: current.realizedPnl + realizedPnl,
      });
    }
    trades.push(createPaperTrade({ fee, index, intent, notional, price: executionPrice, quantity, realizedPnl, runDate, side, source, tradeContext }));
  });

  const positions = Array.from(positionsBySymbol.values())
    .map((position) => markPaperPosition(position, prices.get(symbolKey(position.symbol)) ?? position.lastPrice))
    .filter((position) => position.quantity > 0)
    .sort((left, right) => right.marketValue - left.marketValue);
  const positionValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const pendingFundValue = pendingFundOrders.reduce((sum, order) => sum + pendingFundOrderValue(order), 0);
  const equity = Math.max(0, cash) + positionValue + pendingFundValue;
  const attribution = paperSettlementAttribution({
    closingEquity: equity,
    openingState: seeded,
    prices,
    trades,
  });
  const snapshot = createPaperSnapshot({
    attribution,
    benchmark: benchmarkDailyReturnFor(report),
    cash: Math.max(0, cash),
    equity,
    initialCapital: seeded.initialCapital,
    previousSnapshots: seeded.snapshots,
    positionValue,
    runDate,
    skipped,
    tradeCount: trades.length,
  });
  const nextState = normalizePaperSimState({
    ...seeded,
    active: true,
    cash: Math.max(0, cash),
    positions,
    pendingFundOrders,
    trades: [...trades, ...seeded.trades].slice(0, MAX_PAPER_SIM_TRADES),
    snapshots: [snapshot, ...seeded.snapshots].slice(0, MAX_PAPER_SIM_SNAPSHOTS),
    updatedAt: now,
    lastRunDate: runDate,
    nextRunHint: pendingFundOrders.length
      ? `${pendingFundOrders.length} 笔基金${paperFundOrderStatusLabel(pendingFundOrders[0])} · ${paperFundOrderNextDate(pendingFundOrders[0])}`
      : `下个交易日 ${nextChinaTradingDay(runDate)}`,
  });

  return {
    state: nextState,
    summary: summarizePaperSimState(nextState),
    trades,
    skipped,
    skipReasons,
    alreadyRan: false,
    marketClosed: false,
  };
}

function createPendingFundOrder({
  buyFeeRate,
  confirmedNav,
  cutoffTime,
  intent,
  referenceNav,
  requestedNotional,
  navCapturedDate,
  navSource,
  reservedCash,
  reservedQuantity,
  runDate,
  schedule,
  sellFeeRate,
  side,
  source,
  tradeContext,
}: {
  buyFeeRate: number;
  confirmedNav: number;
  cutoffTime: string;
  intent: OrderIntent;
  referenceNav: number;
  requestedNotional: number;
  navCapturedDate: string;
  navSource: string;
  reservedCash: number;
  reservedQuantity: number;
  runDate: string;
  schedule: { afterCutoff: boolean; navDate: string; confirmDate: string; cashArrivalDate: string };
  sellFeeRate: number;
  side: "BUY" | "SELL";
  source: string;
  tradeContext: PaperSimTradeContext;
}): PaperSimPendingFundOrder {
  return {
    id: `pfund-${Date.now()}-${symbolKey(intent.symbol)}-${side}`,
    submittedAt: new Date().toISOString(),
    submittedDate: runDate,
    submittedAfterCutoff: schedule.afterCutoff,
    cutoffTime,
    navDate: schedule.navDate,
    navCapturedDate,
    navSource,
    confirmDate: schedule.confirmDate,
    cashArrivalDate: side === "SELL" ? schedule.cashArrivalDate : schedule.confirmDate,
    settlementStage: "nav-pending",
    settledGross: 0,
    settledFee: 0,
    settledQuantity: 0,
    cashCredited: false,
    symbol: symbolKey(intent.symbol),
    name: intent.name || symbolKey(intent.symbol),
    side,
    requestedNotional,
    referenceNav,
    confirmedNav,
    buyFeeRate,
    sellFeeRate,
    reservedCash,
    reservedQuantity,
    orderKey: intent.key,
    source,
    ...tradeContext,
    decisionState: intent.state,
    decisionDetail: intent.detail,
    targetWeight: intent.weight,
    scalingPolicyKey: intent.scaling?.policyKey,
    strategyInstanceKey: intent.scaling?.instanceKey,
    trancheIndex: intent.scaling?.trancheIndex,
    replacementLink: intent.replacementLink ?? null,
  };
}

function nextReplacementBuyIntent(
  link: ReplacementOrderLink,
  targetWeight: string,
  currentPurchaseLimit?: number,
): OrderIntent {
  const batchAmount = Math.min(
    link.remainingBuyAmount,
    link.batchAmount > 0 ? link.batchAmount : link.remainingBuyAmount,
    currentPurchaseLimit && currentPurchaseLimit > 0 ? currentPurchaseLimit : Number.POSITIVE_INFINITY,
  );
  const remainingBuyAmount = Math.max(0, link.remainingBuyAmount - batchAmount);
  return {
    key: `replacement-${link.id}-buy-${Math.round(remainingBuyAmount * 100)}`,
    symbol: link.targetSymbol,
    name: link.targetName || link.targetSymbol,
    side: "BUY",
    state: "赎回到账后申购",
    tone: "caution",
    amount: batchAmount.toFixed(2),
    weight: targetWeight,
    detail: remainingBuyAmount > 0
      ? `关联替换当前批，剩余 ${remainingBuyAmount.toFixed(2)} 待后续交易日申购。`
      : "关联替换最后一批申购。",
    replacementLink: {
      ...link,
      stage: "subscribe",
      remainingBuyAmount,
    },
  };
}

function createFundConfirmationTrade({
  fee,
  index,
  nav,
  order,
  quantity,
  realizedPnl,
  runDate,
}: {
  fee: number;
  index: number;
  nav: number;
  order: PaperSimPendingFundOrder;
  quantity: number;
  realizedPnl: number;
  runDate: string;
}): PaperSimTrade {
  const notional = quantity * nav;
  return {
    id: `ptrade-fund-${Date.now()}-${index}-${order.symbol}`,
    at: new Date().toISOString(),
    runDate,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    quantity,
    price: nav,
    notional,
    fee,
    commission: fee,
    stampDuty: 0,
    transferFee: 0,
    slippage: 0,
    realizedPnl,
    orderKey: order.orderKey,
    source: order.source,
    ruleLabel: `场外基金 · ${order.navDate} 净值`,
    ruleNote: `委托于 ${order.submittedDate} 提交（${order.submittedAfterCutoff ? `${order.cutoffTime} 后` : `${order.cutoffTime} 前`}），目标净值日 ${order.navDate}${order.navCapturedDate && order.navCapturedDate !== order.navDate ? `，实际取最近可用净值 ${order.navCapturedDate}` : ""}、份额确认日 ${runDate}；净值来源 ${order.navSource || "未记录"}；申购费 ${(order.buyFeeRate * 100).toFixed(2)}%、赎回费 ${(order.sellFeeRate * 100).toFixed(2)}%。`,
    profileKey: order.profileKey,
    profileName: order.profileName,
    strategyKey: order.strategyKey,
    strategyName: order.strategyName,
    decisionState: order.decisionState,
    decisionDetail: order.decisionDetail,
    targetWeight: order.targetWeight,
    scalingPolicyKey: order.scalingPolicyKey,
    strategyInstanceKey: order.strategyInstanceKey,
    trancheIndex: order.trancheIndex,
    replacementLink: order.replacementLink,
  };
}

function createPaperTrade({
  feeBreakdown,
  fee,
  index,
  intent,
  notional,
  price,
  quantity,
  realizedPnl,
  ruleLabel = "通用模拟",
  ruleNote = "按通用滑点和费率成交。",
  runDate,
  side,
  slippage,
  source,
  tradeContext,
}: {
  feeBreakdown?: AShareFeeBreakdown;
  fee: number;
  index: number;
  intent: OrderIntent;
  notional: number;
  price: number;
  quantity: number;
  realizedPnl: number;
  ruleLabel?: string;
  ruleNote?: string;
  runDate: string;
  side: "BUY" | "SELL";
  slippage?: number;
  source: string;
  tradeContext: PaperSimTradeContext;
}) {
  const now = new Date().toISOString();
  return {
    id: `ptrade-${Date.now()}-${index}-${symbolKey(intent.symbol)}`,
    at: now,
    runDate,
    symbol: symbolKey(intent.symbol),
    name: intent.name || symbolKey(intent.symbol),
    side,
    quantity,
    price,
    notional,
    fee,
    commission: feeBreakdown?.commission ?? fee,
    stampDuty: feeBreakdown?.stampDuty ?? 0,
    transferFee: feeBreakdown?.transferFee ?? 0,
    slippage: slippage ?? notional * PAPER_SIM_SLIPPAGE_RATE,
    realizedPnl,
    orderKey: intent.key,
    source,
    ruleLabel,
    ruleNote,
    ...tradeContext,
    decisionState: intent.state,
    decisionDetail: intent.detail,
    targetWeight: intent.weight,
    scalingPolicyKey: intent.scaling?.policyKey,
    strategyInstanceKey: intent.scaling?.instanceKey,
    trancheIndex: intent.scaling?.trancheIndex,
    replacementLink: intent.replacementLink ?? null,
  };
}

function createPaperSnapshot({
  attribution,
  benchmark,
  cash,
  equity,
  initialCapital,
  positionValue,
  previousSnapshots,
  runDate,
  skipped,
  tradeCount,
}: {
  attribution: {
    previousEquity: number;
    dailyPnl: number;
    dailyPnlPct: number;
    marketPnl: number;
    executionPnl: number;
    feePnl: number;
    otherPnl: number;
  };
  benchmark: { symbol: string; dailyReturnPct: number | null };
  cash: number;
  equity: number;
  initialCapital: number;
  positionValue: number;
  previousSnapshots: PaperSimSnapshot[];
  runDate: string;
  skipped: number;
  tradeCount: number;
}): PaperSimSnapshot {
  const previousPeak = previousSnapshots.reduce((peak, snapshot) => Math.max(peak, snapshot.equity), initialCapital);
  const peak = Math.max(previousPeak, equity);
  const pnl = initialCapital > 0 ? equity - initialCapital : 0;
  const pnlPct = initialCapital > 0 ? (pnl / initialCapital) * 100 : 0;
  const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
  const previousBenchmarkReturn = previousSnapshots[0]?.benchmarkReturnPct ?? 0;
  const benchmarkAvailable = benchmark.dailyReturnPct !== null;
  const benchmarkDailyReturnPct = previousSnapshots.length && benchmarkAvailable ? benchmark.dailyReturnPct ?? 0 : 0;
  const benchmarkReturnPct = previousSnapshots.length
    ? ((1 + previousBenchmarkReturn / 100) * (1 + benchmarkDailyReturnPct / 100) - 1) * 100
    : 0;
  const excessDailyReturnPct = attribution.dailyPnlPct - benchmarkDailyReturnPct;
  const excessReturnPct = pnlPct - benchmarkReturnPct;
  const cumulativeFees = (previousSnapshots[0]?.cumulativeFees ?? 0) + Math.abs(attribution.feePnl);
  const feeDragPct = initialCapital > 0 ? -(cumulativeFees / initialCapital) * 100 : 0;
  return {
    id: `psnap-${runDate}-${Date.now()}`,
    at: new Date().toISOString(),
    runDate,
    equity,
    cash,
    positionValue,
    pnl,
    pnlPct,
    drawdownPct,
    ...attribution,
    benchmarkSymbol: benchmark.symbol,
    benchmarkAvailable,
    benchmarkDailyReturnPct,
    benchmarkReturnPct,
    excessDailyReturnPct,
    excessReturnPct,
    cumulativeFees,
    feeDragPct,
    tradeCount,
    skippedCount: skipped,
    summary: `${tradeCount} 笔成交，当日 ${formatPercent(attribution.dailyPnlPct)}，累计 ${formatPercent(pnlPct)}`,
  };
}

function paperSettlementAttribution({
  closingEquity,
  openingState,
  prices,
  trades,
}: {
  closingEquity: number;
  openingState: PaperSimState;
  prices: Map<string, number>;
  trades: PaperSimTrade[];
}) {
  const previousEquity = openingState.snapshots[0]?.equity ?? openingState.initialCapital;
  const dailyPnl = closingEquity - previousEquity;
  const dailyPnlPct = previousEquity > 0 ? (dailyPnl / previousEquity) * 100 : 0;
  const marketPnl = openingState.positions.reduce((sum, position) => {
    const mark = firstPositiveNumber(prices.get(symbolKey(position.symbol)), position.lastPrice) ?? position.lastPrice;
    return sum + (mark - position.lastPrice) * position.quantity;
  }, 0);
  const executionPnl = trades.reduce((sum, trade) => {
    const mark = firstPositiveNumber(prices.get(symbolKey(trade.symbol)), trade.price) ?? trade.price;
    const impact = trade.side === "BUY"
      ? (mark - trade.price) * trade.quantity
      : (trade.price - mark) * trade.quantity;
    return sum + impact;
  }, 0);
  const feePnl = -trades.reduce((sum, trade) => sum + trade.fee, 0);
  const otherPnl = dailyPnl - marketPnl - executionPnl - feePnl;
  return {
    previousEquity,
    dailyPnl,
    dailyPnlPct,
    marketPnl,
    executionPnl,
    feePnl,
    otherPnl,
  };
}

function benchmarkDailyReturnFor(report: MarketAnalysisReport) {
  const benchmarkSymbol = symbolKey(report.backtest.benchmarkSymbol || "");
  const asset = report.assetStatuses.find((item) => symbolKey(item.symbol) === benchmarkSymbol)
    ?? report.assetStatuses.find((item) => item.assetKind === "benchmark");
  const technical = report.technicalRows.find((item) => symbolKey(item.symbol) === benchmarkSymbol);
  const dailyReturnPct = finiteNumber(technical?.change1d) ?? finiteNumber(asset?.change1d);
  return {
    symbol: benchmarkSymbol || asset?.symbol || "基准",
    dailyReturnPct,
  };
}

function referencePricesFor({ holdings, report }: { holdings: HoldingRecord[]; report: MarketAnalysisReport }) {
  const prices = new Map<string, number>();
  holdings.forEach((holding) => {
    const price = firstPositiveNumber(holding.currentPrice);
    if (price) prices.set(symbolKey(holding.symbol), price);
  });
  report.assetStatuses.forEach((asset) => {
    const price = firstPositiveNumber(asset.close);
    if (price) prices.set(symbolKey(asset.symbol), price);
  });
  report.technicalRows.forEach((row) => {
    const price = firstPositiveNumber(row.close);
    if (price) prices.set(symbolKey(row.symbol), price);
  });
  return prices;
}

function fundNavEvidenceFor(
  holding: HoldingRecord | undefined,
  report: MarketAnalysisReport,
  evidence: Array<{ symbol: string; nav: number; asOf: string; source: string }>,
  symbol: string,
  targetDate: string,
) {
  const exact = evidence.find((item) => symbolKey(item.symbol) === symbol && item.asOf === targetDate && item.nav > 0);
  if (exact) return exact;
  if (holding?.confirmedNav && holding.confirmedNavAsOf) {
    return {
      nav: holding.confirmedNav,
      asOf: holding.confirmedNavAsOf,
      source: holding.quoteSource === "eastmoney_tiantian" ? "东方财富 / 天天基金" : "持仓记录",
    };
  }
  return {
    nav: 0,
    asOf: "",
    source: report.sourceLabel,
  };
}

function parseOrderAmount(value: string) {
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g);
  if (!normalized?.length) return 0;
  return Math.abs(Number(normalized[0])) || 0;
}

function parseOrderLimit(intent: OrderIntent) {
  const limit = (intent as Partial<OrderIntent> & { limit?: string }).limit;
  if (!limit) return null;
  const parsed = Number(limit.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function existingPositionPrice(position: PaperSimPosition | undefined) {
  return position ? firstPositiveNumber(position.lastPrice, position.avgCost) : null;
}
