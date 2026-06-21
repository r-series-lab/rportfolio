import {
  Eye,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  HOLDING_ASSET_TYPE_OPTIONS,
  HOLDING_CURRENCY_OPTIONS,
  HOLDING_MARKET_OPTIONS,
  HOLDING_QUOTE_SOURCE_OPTIONS,
  HOLDING_ROLE_OPTIONS,
  holdingAssetTypeLabel,
  holdingQuoteSourceLabel,
  holdingRoleLabel,
  isHoldingRecord,
  type HoldingAssetType,
  type HoldingQuoteSource,
  type HoldingRecord,
  type HoldingRole,
} from "../lib/holdings";
import { importProfileConfig, lookupFundProfileSeed } from "../lib/analysis";
import { buildFundProfileContentFromHolding } from "../lib/fund-profile-builder";
import {
  DEFAULT_POSITION_POLICY,
  isCashHolding,
  normalizePositionPolicy,
  POSITION_REASON_TEXT,
  targetBandForHolding,
  type AssetDecision,
  type ExecutionState,
  type PositionPlan,
  type PositionPlanAction,
  type PositionPolicy,
  type ReasonCode,
  type RecommendationIntent,
} from "../lib/position-plan";
import type { ProfileSummary } from "../lib/types";
import {
  type TradeRecord,
  type TradeSide,
} from "../lib/trades";

type HoldingDraft = {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  role: HoldingRole;
  assetType: HoldingAssetType;
  quoteSource: HoldingQuoteSource;
  quantity: string;
  costPrice: string;
  currentPrice: string;
  targetMinWeight: string;
  targetWeight: string;
  targetMaxWeight: string;
  notes: string;
};

type HoldingView = HoldingRecord & {
  costValue: number;
  marketValue: number;
  pnl: number;
  pnlPct: number | null;
  weight: number;
  drift: number | null;
};

type HoldingHorizonAdvice = {
  label: string;
  detail: string;
  tone: PositionPlanAction["tone"];
};

type HoldingAdviceView = {
  action: string;
  amount: string;
  amountTone: PositionPlanAction["tone"];
  delta: string;
  longAmount: string;
  longTone: PositionPlanAction["tone"];
  maxAmount: string;
  maxTone: PositionPlanAction["tone"];
  midAmount: string;
  midTone: PositionPlanAction["tone"];
  long: HoldingHorizonAdvice;
  medium: HoldingHorizonAdvice;
  reason: string;
  short: HoldingHorizonAdvice;
  shortAmount: string;
  shortTone: PositionPlanAction["tone"];
  state: string;
  tone: PositionPlanAction["tone"];
};

type PolicyDraft = {
  minCashWeight: string;
  singleAssetCap: string;
  maxSingleAddWeight: string;
};

type TradeDraft = {
  symbol: string;
  name: string;
  side: TradeSide;
  tradeDate: string;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  notes: string;
};

const EMPTY_DRAFT: HoldingDraft = {
  symbol: "",
  name: "",
  market: "US",
  currency: "USD",
  role: "real",
  assetType: "stock",
  quoteSource: "manual",
  quantity: "",
  costPrice: "",
  currentPrice: "",
  targetMinWeight: "",
  targetWeight: "",
  targetMaxWeight: "",
  notes: "",
};

const EMPTY_TRADE_DRAFT: TradeDraft = {
  symbol: "",
  name: "",
  side: "buy",
  tradeDate: todayDate(),
  quantity: "",
  price: "",
  fee: "",
  currency: "CNY",
  notes: "",
};

type HoldingsWorkspaceProps = {
  holdings: HoldingRecord[];
  persistenceMessage: string;
  onHoldingsChange: Dispatch<SetStateAction<HoldingRecord[]>>;
  onPositionPolicyChange: Dispatch<SetStateAction<PositionPolicy>>;
  onTradesChange: Dispatch<SetStateAction<TradeRecord[]>>;
  positionPlan: PositionPlan;
  positionPolicy: PositionPolicy;
  profiles: ProfileSummary[];
  rightRailCollapsed: boolean;
  onProfileGenerated?: (summary: ProfileSummary) => void;
};

export function HoldingsWorkspace({
  holdings,
  persistenceMessage,
  onHoldingsChange,
  onPositionPolicyChange,
  onTradesChange,
  positionPlan,
  positionPolicy,
  profiles,
  rightRailCollapsed,
  onProfileGenerated,
}: HoldingsWorkspaceProps) {
  const [draft, setDraft] = useState<HoldingDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [fundLookupLoading, setFundLookupLoading] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState(() => policyToDraft(positionPolicy));
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeDraft, setTradeDraft] = useState<TradeDraft>(EMPTY_TRADE_DRAFT);
  const [profileGeneratingId, setProfileGeneratingId] = useState<string | null>(null);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const symbolInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedHoldings = useMemo(() => holdings.filter(isHoldingRecord), [holdings]);
  const realTotal = useMemo(
    () => normalizedHoldings.reduce((sum, holding) => sum + valueOf(holding), 0),
    [normalizedHoldings],
  );
  const rows = useMemo(
    () => normalizedHoldings.map((holding) => toHoldingView(holding, realTotal)),
    [normalizedHoldings, realTotal],
  );
  const actionByHoldingId = useMemo(() => {
    return new Map<string, PositionPlanAction>(
      positionPlan.actions.flatMap((action) => (action.holdingId ? [[action.holdingId, action] as const] : [])),
    );
  }, [positionPlan.actions]);
  const decisionByHoldingId = useMemo(() => {
    return new Map<string, AssetDecision>(positionPlan.decision.assetDecisions.map((decision) => [decision.holdingId, decision]));
  }, [positionPlan.decision.assetDecisions]);
  const stats = useMemo(() => summarizeHoldings(rows), [rows]);
  const selectedHolding = useMemo(
    () => rows.find((row) => row.id === selectedHoldingId) ?? rows[0] ?? null,
    [rows, selectedHoldingId],
  );
  const selectedHoldingBand = selectedHolding ? targetBandForHolding(selectedHolding, positionPlan.policy) : null;
  const selectedHoldingAction = selectedHolding ? actionByHoldingId.get(selectedHolding.id) : undefined;
  const selectedHoldingDecision = selectedHolding ? decisionByHoldingId.get(selectedHolding.id) : undefined;
  const selectedHoldingAdvice =
    selectedHolding && selectedHoldingBand
      ? holdingAdviceFor(selectedHolding, selectedHoldingAction, selectedHoldingBand, positionPlan, selectedHoldingDecision)
      : null;

  useEffect(() => {
    if (!rows.length) {
      if (selectedHoldingId) {
        setSelectedHoldingId(null);
      }
      return;
    }
    if (!selectedHoldingId || !rows.some((row) => row.id === selectedHoldingId)) {
      setSelectedHoldingId(rows[0].id);
    }
  }, [rows, selectedHoldingId]);

  useEffect(() => {
    if (!policyOpen) {
      setPolicyDraft(policyToDraft(positionPolicy));
    }
  }, [policyOpen, positionPolicy]);

  const updateDraft = (field: keyof HoldingDraft, value: string) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "assetType" && value === "fund") {
        next.market = "CN";
        next.currency = "CNY";
        next.quoteSource = "eastmoney_tiantian";
      }
      if (field === "assetType" && value !== "fund" && current.quoteSource === "eastmoney_tiantian") {
        next.quoteSource = "manual";
      }
      return next;
    });
    setErrorMessage("");
  };

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setErrorMessage("");
    setStatusMessage("已清空编辑区。");
    window.requestAnimationFrame(() => symbolInputRef.current?.focus());
  };

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setErrorMessage("");
    setStatusMessage("");
    setFormOpen(true);
    window.requestAnimationFrame(() => symbolInputRef.current?.focus());
  };

  const closeForm = () => {
    setFormOpen(false);
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setErrorMessage("");
  };

  const openPolicy = () => {
    setPolicyDraft(policyToDraft(positionPolicy));
    setErrorMessage("");
    setPolicyOpen(true);
  };

  const closePolicy = () => {
    setPolicyOpen(false);
    setPolicyDraft(policyToDraft(positionPolicy));
  };

  const openTrade = () => {
    const firstReal = rows.find((row) => row.role === "real" && row.assetType !== "cash") ?? rows[0];
    setTradeDraft({
      ...EMPTY_TRADE_DRAFT,
      symbol: firstReal?.symbol ?? "",
      name: firstReal?.name ?? "",
      price: firstReal?.currentPrice ? String(firstReal.currentPrice) : "",
      currency: firstReal?.currency ?? "CNY",
      tradeDate: todayDate(),
    });
    setErrorMessage("");
    setTradeOpen(true);
  };

  const closeTrade = () => {
    setTradeOpen(false);
    setTradeDraft(EMPTY_TRADE_DRAFT);
  };

  const updateTradeDraft = (field: keyof TradeDraft, value: string) => {
    setTradeDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "symbol") {
        const holding = normalizedHoldings.find((item) => item.symbol === value.toUpperCase());
        if (holding) {
          next.name = holding.name;
          next.currency = holding.currency;
          next.price = holding.currentPrice ? String(holding.currentPrice) : next.price;
        }
      }
      return next;
    });
    setErrorMessage("");
  };

  const submitTrade = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = createTradeFromDraft(tradeDraft);
    if (!parsed.ok) {
      setErrorMessage(parsed.message);
      setStatusMessage(parsed.message);
      toast.error(parsed.message);
      return;
    }
    onTradesChange((current) => [parsed.trade, ...current]);
    setTradeOpen(false);
    setTradeDraft(EMPTY_TRADE_DRAFT);
    setStatusMessage(`已记录 ${parsed.trade.symbol} ${parsed.trade.side === "buy" ? "买入" : "卖出"}。`);
    toast.success(`已记录 ${parsed.trade.symbol} ${parsed.trade.side === "buy" ? "买入" : "卖出"}`);
  };

  const updatePolicyDraft = (field: keyof PolicyDraft, value: string) => {
    setPolicyDraft((current) => ({ ...current, [field]: value }));
    setErrorMessage("");
  };

  const resetPolicy = () => {
    setPolicyDraft(policyToDraft(DEFAULT_POSITION_POLICY));
  };

  const submitPolicy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = policyFromDraft(policyDraft);
    if (!parsed.ok) {
      setErrorMessage(parsed.message);
      setStatusMessage(parsed.message);
      toast.error(parsed.message);
      return;
    }
    onPositionPolicyChange(parsed.policy);
    setPolicyOpen(false);
    setStatusMessage("已更新仓位规则。");
    toast.success("仓位规则已更新");
  };

  const startEdit = (holding: HoldingRecord) => {
    setDraft({
      symbol: holding.symbol,
      name: holding.name,
      market: holding.market,
      currency: holding.currency,
      role: holding.role,
      assetType: holding.assetType ?? "stock",
      quoteSource: holding.quoteSource ?? "manual",
      quantity: String(holding.quantity || ""),
      costPrice: String(holding.costPrice || ""),
      currentPrice: String(holding.currentPrice || ""),
      targetMinWeight: String(holding.targetMinWeight || ""),
      targetWeight: String(holding.targetWeight || ""),
      targetMaxWeight: String(holding.targetMaxWeight || ""),
      notes: holding.notes,
    });
    setEditingId(holding.id);
    setFormOpen(true);
    setStatusMessage(`正在编辑 ${holding.symbol}。`);
    window.requestAnimationFrame(() => symbolInputRef.current?.focus());
  };

  const deleteHolding = (holding: HoldingRecord) => {
    const confirmed = window.confirm(`删除 ${holding.symbol}？`);
    if (!confirmed) return;
    onHoldingsChange((current) => current.filter((item) => item.id !== holding.id));
    if (editingId === holding.id) {
      resetDraft();
    }
    setStatusMessage(`已删除 ${holding.symbol}。`);
    toast.success(`已删除 ${holding.symbol}`);
  };

  const generateProfileForHolding = async (holding: HoldingRecord) => {
    if ((holding.assetType ?? "stock") !== "fund") {
      setStatusMessage("只有基金持仓可以直接生成基金 Profile。");
      toast.warning("只有基金持仓可以生成基金 Profile");
      return;
    }
    const code = holding.symbol.trim();
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("基金 Profile 生成需要 6 位公募基金代码。");
      toast.error("基金 Profile 生成需要 6 位公募基金代码");
      return;
    }

    setProfileGeneratingId(holding.id);
    setErrorMessage("");
    setStatusMessage(`正在同步 ${code}…`);
    try {
      const rawSeed = await lookupFundProfileSeed(code);
      const seed = {
        ...rawSeed,
        name: rawSeed.name && rawSeed.name !== `基金 ${rawSeed.code}` ? rawSeed.name : holding.name,
      };
      const nav = seed.estimateNav ?? seed.nav;
      const nextHolding = {
        ...holding,
        symbol: seed.code || code,
        name: seed.name || holding.name || code,
        market: "CN",
        currency: "CNY",
        assetType: "fund" as const,
        quoteSource: "eastmoney_tiantian" as const,
        currentPrice: nav === null ? holding.currentPrice : nav,
        notes: holding.notes || fundSeedNote(seed.manager, seed.issuer, seed.sourceName),
      };
      const profileContent = buildFundProfileContentFromHolding(nextHolding, seed, profiles);
      const summary = await importProfileConfig(profileContent);
      onHoldingsChange((current) =>
        current.map((item) => (item.id === holding.id ? { ...nextHolding, profileKey: summary.key } : item)),
      );
      onProfileGenerated?.(summary);
      setStatusMessage(`已同步 ${nextHolding.name} 与 Profile。`);
      toast.success(`已同步 ${nextHolding.name} 与 Profile`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败。";
      setErrorMessage(message);
      setStatusMessage("同步失败。");
      toast.error(message);
    } finally {
      setProfileGeneratingId(null);
    }
  };

  const lookupFund = async () => {
    const code = draft.symbol.trim();
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("基金识别需要 6 位公募基金代码。");
      toast.error("基金识别需要 6 位公募基金代码");
      symbolInputRef.current?.focus();
      return;
    }

    setFundLookupLoading(true);
    setErrorMessage("");
    setStatusMessage("正在从东方财富 / 天天基金识别基金…");
    try {
      const seed = await lookupFundProfileSeed(code);
      const nav = seed.estimateNav ?? seed.nav;
      setDraft((current) => ({
        ...current,
        symbol: seed.code || code,
        name: seed.name || current.name,
        market: "CN",
        currency: "CNY",
        assetType: "fund",
        quoteSource: "eastmoney_tiantian",
        currentPrice: nav === null ? current.currentPrice : String(nav),
        notes: current.notes || fundSeedNote(seed.manager, seed.issuer, seed.sourceName),
      }));
      setStatusMessage(`已识别 ${seed.name || code}。`);
      toast.success(`已识别 ${seed.name || code}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "基金识别失败。";
      setErrorMessage(message);
      setStatusMessage("基金识别失败。");
      toast.error(message);
    } finally {
      setFundLookupLoading(false);
    }
  };

  const submitDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const existing = editingId ? normalizedHoldings.find((holding) => holding.id === editingId) : undefined;
    const next = createHoldingFromDraft(draft, editingId, existing);
    if (!next.ok) {
      setErrorMessage(next.message);
      setStatusMessage(next.message);
      toast.error(next.message);
      symbolInputRef.current?.focus();
      return;
    }

    onHoldingsChange((current) => {
      if (editingId) {
        return current.map((item) => (item.id === editingId ? next.holding : item));
      }
      return [next.holding, ...current];
    });
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setFormOpen(false);
    setErrorMessage("");
    setStatusMessage(editingId ? `已更新 ${next.holding.symbol}。` : `已添加 ${next.holding.symbol}。`);
    toast.success(editingId ? `已更新 ${next.holding.symbol}` : `已添加 ${next.holding.symbol}`);
  };

  useEffect(() => {
    if (!formOpen && !policyOpen && !tradeOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (tradeOpen) {
          closeTrade();
        } else if (policyOpen) {
          closePolicy();
        } else {
          closeForm();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [formOpen, policyOpen, tradeOpen]);

  return (
    <section
      className={`holdings-workspace ${!rightRailCollapsed ? "has-detail-rail" : "is-detail-rail-collapsed"}`}
      aria-label="持仓管理"
    >
      <div className="holdings-main-column">
        <div className="holdings-summary-grid">
          <SummaryCard icon={<ShieldCheck aria-hidden="true" />} label="真实市值" value={stats.marketValueLabel} title="代理和观察资产不计入" />
          <SummaryCard
            icon={<Layers3 aria-hidden="true" />}
            label={positionPlan.decision.cashDecision.label}
            value={positionPlan.hasCashInstrument ? formatCurrency(positionPlan.decision.pendingDeployBudget, positionPlan.currency) : "未记录"}
            detail={`${formatNumber(positionPlan.cashWeight, 1)}% · 目标 ${formatNumber(positionPlan.decision.cashDecision.targetMinWeight, 0)}%-${formatNumber(positionPlan.decision.cashDecision.targetMaxWeight, 0)}%`}
            tone={positionPlan.decision.cashDecision.tone}
          />
          <SummaryCard
            icon={<Eye aria-hidden="true" />}
            label="今日模拟"
            value={formatCurrency(positionPlan.decision.executableBudget, positionPlan.currency)}
            detail={`触发 ${formatCurrency(positionPlan.decision.triggerBudget, positionPlan.currency)} · ${executionStateLabel(positionPlan.decision.executionState)}`}
            tone={positionPlan.decision.executableBudget > 0 ? "positive" : positionPlan.statusTone}
          />
          <SummaryCard
            icon={<Layers3 aria-hidden="true" />}
            label="资产池容量"
            value={`${formatCurrency(positionPlan.decision.assetCapacityToMax, positionPlan.currency)}`}
            detail={`补中位 ${formatCurrency(positionPlan.decision.assetCapacityToMid, positionPlan.currency)} · 缺口 ${formatCurrency(positionPlan.decision.unallocatableExcessCash, positionPlan.currency)}`}
            title={positionPlan.summary}
            tone={positionPlan.decision.unallocatableExcessCash > 0 ? "caution" : "neutral"}
          />
          <SummaryCard
            icon={<ShieldCheck aria-hidden="true" />}
            label="Profile 状态"
            value={profileHealthLabel(positionPlan.decision.profileHealth)}
            detail={`${formatNumber(positionPlan.decision.profileHealth.minSum, 0)}%-${formatNumber(positionPlan.decision.profileHealth.maxSum, 0)}%`}
            title={positionPlan.decision.profileHealth.message}
            tone={profileHealthTone(positionPlan.decision.profileHealth)}
          />
        </div>

        <div className="holdings-workbench">
          <div className="holdings-grid">
            <Card size="sm" className="holdings-list-card" aria-labelledby="holdings-list-title">
              <div className="holding-card-head">
                <div>
                  <h2 id="holdings-list-title">资产列表</h2>
                  <p>{rows.length} 项资产 · 点击行查看执行建议</p>
                </div>
                <div className="holding-list-actions">
                  {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
                  <Button type="button" variant="outline" size="sm" className="holding-toolbar-button" onClick={openPolicy}>
                    <SlidersHorizontal aria-hidden="true" />
                    规则
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="holding-toolbar-button" onClick={openTrade}>
                    <Plus aria-hidden="true" />
                    交易
                  </Button>
                  <Button type="button" size="sm" className="holding-toolbar-button is-primary" onClick={openCreate}>
                    <Plus aria-hidden="true" />
                    添加
                  </Button>
                </div>
              </div>

              {rows.length ? (
                <div className="holdings-asset-workbench">
                  <div className="holdings-table-wrap">
                    <table className="holdings-table holdings-asset-table">
                      <thead>
                        <tr>
                          <th scope="col">资产</th>
                          <th scope="col">市值</th>
                          <th scope="col">仓位</th>
                          <th scope="col">今日</th>
                          <th scope="col">短期</th>
                          <th scope="col">中期</th>
                          <th scope="col">长期</th>
                          <th scope="col">状态</th>
                          {rightRailCollapsed ? <th scope="col">管理</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((holding) => {
                          const action = actionByHoldingId.get(holding.id);
                          const decision = decisionByHoldingId.get(holding.id);
                          const band = targetBandForHolding(holding, positionPlan.policy);
                          const advice = holdingAdviceFor(holding, action, band, positionPlan, decision);
                          const selected = selectedHolding?.id === holding.id;
                          return (
                            <tr
                              key={holding.id}
                              className={selected ? "is-selected" : undefined}
                              tabIndex={0}
                              aria-selected={selected}
                              onClick={() => setSelectedHoldingId(holding.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedHoldingId(holding.id);
                                }
                              }}
                            >
                              <td className="holding-name-cell" title={holding.profileKey ? `Profile ${holding.profileKey}` : holding.name}>
                                <strong translate="no">{holding.symbol}</strong>
                                <span>{holding.name}</span>
                                <small>{holdingAssetTypeLabel(holding.assetType)} · {holdingRoleLabel(holding.role)}</small>
                              </td>
                              <td className="holding-value-cell">
                                <strong>{holding.marketValue > 0 ? formatCurrency(holding.marketValue, holding.currency) : "—"}</strong>
                                <small>{holding.market} · {holdingQuoteSourceLabel(holding.quoteSource)}</small>
                              </td>
                              <td className="holding-weight-cell">
                                <strong>{holding.role === "real" ? `${formatNumber(holding.weight, 1)}%` : "—"}</strong>
                                <small>{band.target > 0 ? band.label : isCashHolding(holding) ? `>=${formatNumber(positionPlan.policy.minCashWeight, 0)}%` : "未设目标"}</small>
                              </td>
                              <td className={`holding-amount-cell is-${advice.amountTone}`} title={`${advice.action} · ${advice.delta}`}>
                                <strong>{advice.amount}</strong>
                              </td>
                              <td className={`holding-horizon-cell is-${advice.shortTone}`} title={advice.short.detail}>
                                <strong>{advice.shortAmount}</strong>
                              </td>
                              <td className={`holding-horizon-cell is-${advice.midTone}`} title={advice.medium.detail}>
                                <strong>{advice.midAmount}</strong>
                              </td>
                              <td className={`holding-horizon-cell is-${advice.longTone}`} title={advice.long.detail}>
                                <strong>{advice.longAmount}</strong>
                              </td>
                              <td className={`holding-horizon-cell is-${advice.long.tone}`} title={advice.long.detail}>
                                <strong>{advice.state}</strong>
                                <small>{advice.reason}</small>
                              </td>
                              {rightRailCollapsed ? (
                                <td className="holding-row-actions" aria-label={`${holding.symbol} 操作`}>
                                  <div>
                                    {holding.assetType === "fund" ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            className={`holding-profile-button ${holding.profileKey ? "is-linked" : ""}`}
                                            aria-label={`同步 ${holding.symbol} 基金资料与 Profile`}
                                            disabled={profileGeneratingId === holding.id}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void generateProfileForHolding(holding);
                                            }}
                                          >
                                            <Sparkles aria-hidden="true" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>同步基金资料与 Profile</TooltipContent>
                                      </Tooltip>
                                    ) : null}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-sm"
                                          aria-label={`编辑 ${holding.symbol}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            startEdit(holding);
                                          }}
                                        >
                                          <Pencil aria-hidden="true" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>编辑</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="destructive"
                                          size="icon-sm"
                                          aria-label={`删除 ${holding.symbol}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            deleteHolding(holding);
                                          }}
                                        >
                                          <Trash2 aria-hidden="true" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>删除</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="holdings-empty-state">
                  <strong>还没有本地持仓</strong>
                  <p>添加基金、股票、ETF 或现金。</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {!rightRailCollapsed ? (
        <aside className="holdings-detail-rail workspace-inspector-rail" aria-label="资产详情">
          <HoldingDetailPanel
            action={selectedHoldingAction}
            advice={selectedHoldingAdvice}
            band={selectedHoldingBand}
            generating={profileGeneratingId === selectedHolding?.id}
            holding={selectedHolding}
            onDelete={deleteHolding}
            onEdit={startEdit}
            onGenerateProfile={(holding) => void generateProfileForHolding(holding)}
            positionPlan={positionPlan}
          />
        </aside>
      ) : null}

      <Dialog open={formOpen} onOpenChange={(open) => {
        if (!open) closeForm();
      }}>
        <DialogContent className="holding-form-dialog holdings-shadcn-dialog" showCloseButton>
          <form
            className="holding-dialog-form"
            onSubmit={submitDraft}
          >
            <DialogHeader className="holding-card-head holdings-dialog-head">
              <div>
                <DialogDescription>{editingId ? "更新资产、目标仓位与行情来源" : "录入真实持仓、代理资产或观察标的"}</DialogDescription>
                <DialogTitle id="holding-form-title">{editingId ? "编辑资产" : "添加资产"}</DialogTitle>
              </div>
              <div className="holding-dialog-actions">
                <Button type="button" variant="outline" size="sm" onClick={resetDraft}>
                  <RotateCcw aria-hidden="true" />
                  重置
                </Button>
              </div>
            </DialogHeader>

            <div className="holding-role-segment" role="radiogroup" aria-label="持仓角色">
              {HOLDING_ROLE_OPTIONS.map((option) => (
                <label key={option.key} className={draft.role === option.key ? "is-active" : undefined}>
                  <input
                    type="radio"
                    name="holdingRole"
                    value={option.key}
                    checked={draft.role === option.key}
                    onChange={() => updateDraft("role", option.key)}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </label>
              ))}
            </div>

            <div className="holding-form-grid">
              <label className="is-select">
                <span>标的类型</span>
                <select
                  name="holdingAssetType"
                  value={draft.assetType}
                  onChange={(event) => updateDraft("assetType", event.target.value)}
                  aria-label="标的类型"
                >
                  {HOLDING_ASSET_TYPE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="is-select">
                <span>行情源</span>
                <select
                  name="holdingQuoteSource"
                  value={draft.quoteSource}
                  onChange={(event) => updateDraft("quoteSource", event.target.value)}
                  aria-label="行情源"
                >
                  {HOLDING_QUOTE_SOURCE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>代码</span>
                <Input
                  ref={symbolInputRef}
                  name="holdingSymbol"
                  value={draft.symbol}
                  onChange={(event) => updateDraft("symbol", event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={draft.assetType === "fund" ? "例如 6 位基金代码…" : "例如 SMH…"}
                />
              </label>
              <label>
                <span>名称</span>
                <Input
                  name="holdingName"
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  autoComplete="off"
                  placeholder={draft.assetType === "fund" ? "例如 基金名称…" : "例如 半导体 ETF…"}
                />
              </label>
              <label className="is-select">
                <span>市场</span>
                <select
                  name="holdingMarket"
                  value={draft.market}
                  onChange={(event) => updateDraft("market", event.target.value)}
                  aria-label="市场"
                >
                  {HOLDING_MARKET_OPTIONS.map((market) => (
                    <option key={market} value={market}>
                      {market}
                    </option>
                  ))}
                </select>
              </label>
              <label className="is-select">
                <span>币种</span>
                <select
                  name="holdingCurrency"
                  value={draft.currency}
                  onChange={(event) => updateDraft("currency", event.target.value)}
                  aria-label="币种"
                >
                  {HOLDING_CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="is-number">
                <span>份额 / 数量</span>
                <Input
                  name="holdingQuantity"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="999999999"
                  step="any"
                  value={draft.quantity}
                  onChange={(event) => updateDraft("quantity", event.target.value)}
                  autoComplete="off"
                  placeholder={draft.assetType === "fund" ? "例如 1200.35…" : "例如 120…"}
                />
              </label>
              <label className="is-number">
                <span>成本价</span>
                <Input
                  name="holdingCostPrice"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="999999999"
                  step="any"
                  value={draft.costPrice}
                  onChange={(event) => updateDraft("costPrice", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 1.685…"
                />
              </label>
              <label className="is-number">
                <span>{draft.assetType === "fund" ? "最新净值" : "现价"}</span>
                <Input
                  name="holdingCurrentPrice"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="999999999"
                  step="any"
                  value={draft.currentPrice}
                  onChange={(event) => updateDraft("currentPrice", event.target.value)}
                  autoComplete="off"
                  placeholder={draft.assetType === "fund" ? "例如 2.893…" : "例如 182.3…"}
                />
              </label>
              <label className="is-number">
                <span>最小仓位</span>
                <Input
                  name="holdingTargetMinWeight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={draft.targetMinWeight}
                  onChange={(event) => updateDraft("targetMinWeight", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 3…"
                />
              </label>
              <label className="is-number">
                <span>目标仓位</span>
                <Input
                  name="holdingTargetWeight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={draft.targetWeight}
                  onChange={(event) => updateDraft("targetWeight", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 6…"
                />
              </label>
              <label className="is-number">
                <span>最大仓位</span>
                <Input
                  name="holdingTargetMaxWeight"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={draft.targetMaxWeight}
                  onChange={(event) => updateDraft("targetMaxWeight", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 8…"
                />
              </label>
              <label className="is-wide">
                <span>备注</span>
                <Textarea
                  name="holdingNotes"
                  value={draft.notes}
                  onChange={(event) => updateDraft("notes", event.target.value)}
                  autoComplete="off"
                  placeholder={draft.assetType === "fund" ? "例如 消费主动基金，跟踪季报持仓…" : "例如 用作 AI 半导体主线真实仓位…"}
                />
              </label>
            </div>

            <div className="holding-form-tools">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void lookupFund()}
                disabled={fundLookupLoading || draft.assetType !== "fund"}
              >
                <Search aria-hidden="true" />
                {fundLookupLoading ? "识别中" : "识别基金"}
              </Button>
              <p>基金模式可用东方财富 / 天天基金公开资料预填名称和净值；非基金持仓保持手动维护。</p>
            </div>

            <DialogFooter className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>{errorMessage || statusMessage || persistenceMessage}</p>
              <Button type="submit" className="primary-action-button">
                {editingId ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {editingId ? "保存持仓" : "添加持仓"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={(open) => {
        if (!open) closePolicy();
      }}>
        <DialogContent className="holding-form-dialog holdings-shadcn-dialog position-policy-dialog" showCloseButton>
          <form
            className="holding-dialog-form"
            onSubmit={submitPolicy}
          >
            <DialogHeader className="holding-card-head holdings-dialog-head">
              <div>
                <DialogDescription>控制现金底线、单资产上限与单次加仓幅度</DialogDescription>
                <DialogTitle id="position-policy-title">仓位规则</DialogTitle>
              </div>
              <div className="holding-dialog-actions">
                <Button type="button" variant="outline" size="sm" onClick={resetPolicy}>
                  <RotateCcw aria-hidden="true" />
                  默认
                </Button>
              </div>
            </DialogHeader>

            <div className="position-policy-grid">
              <label className="is-number">
                <span>现金下限</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="80"
                  step="any"
                  value={policyDraft.minCashWeight}
                  onChange={(event) => updatePolicyDraft("minCashWeight", event.target.value)}
                  autoComplete="off"
                />
                <small>低于这个比例时暂停新增风险仓位。</small>
              </label>
              <label className="is-number">
                <span>单只上限</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="100"
                  step="any"
                  value={policyDraft.singleAssetCap}
                  onChange={(event) => updatePolicyDraft("singleAssetCap", event.target.value)}
                  autoComplete="off"
                />
                <small>没有单独设置最大仓位时使用这个上限。</small>
              </label>
              <label className="is-number">
                <span>单次加仓</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="50"
                  step="any"
                  value={policyDraft.maxSingleAddWeight}
                  onChange={(event) => updatePolicyDraft("maxSingleAddWeight", event.target.value)}
                  autoComplete="off"
                />
                <small>每条建议单次最多加到组合的这个比例。</small>
              </label>
            </div>

            <DialogFooter className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>{errorMessage || "规则会同时影响持仓页和组合分析页。"}</p>
              <Button type="submit" className="primary-action-button">
                <Save aria-hidden="true" />
                保存规则
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={tradeOpen} onOpenChange={(open) => {
        if (!open) closeTrade();
      }}>
        <DialogContent className="holding-form-dialog holdings-shadcn-dialog trade-form-dialog" showCloseButton>
          <form
            className="holding-dialog-form"
            onSubmit={submitTrade}
          >
            <DialogHeader className="holding-card-head holdings-dialog-head">
              <div>
                <DialogDescription>记录成交以完善交易习惯画像，不自动改写持仓</DialogDescription>
                <DialogTitle id="trade-form-title">记录交易</DialogTitle>
              </div>
            </DialogHeader>

            <div className="trade-side-segment" role="radiogroup" aria-label="交易方向">
              {(["buy", "sell"] as TradeSide[]).map((side) => (
                <label key={side} className={tradeDraft.side === side ? "is-active" : undefined}>
                  <input
                    type="radio"
                    name="tradeSide"
                    value={side}
                    checked={tradeDraft.side === side}
                    onChange={() => updateTradeDraft("side", side)}
                  />
                  <span>{side === "buy" ? "买入" : "卖出"}</span>
                </label>
              ))}
            </div>

            <div className="holding-form-grid">
              <label>
                <span>代码</span>
                <Input
                  name="tradeSymbol"
                  value={tradeDraft.symbol}
                  onChange={(event) => updateTradeDraft("symbol", event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="例如 6 位基金代码…"
                />
              </label>
              <label>
                <span>名称</span>
                <Input
                  name="tradeName"
                  value={tradeDraft.name}
                  onChange={(event) => updateTradeDraft("name", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 银华数字经济…"
                />
              </label>
              <label>
                <span>日期</span>
                <Input
                  name="tradeDate"
                  type="date"
                  value={tradeDraft.tradeDate}
                  onChange={(event) => updateTradeDraft("tradeDate", event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="is-select">
                <span>币种</span>
                <select
                  name="tradeCurrency"
                  value={tradeDraft.currency}
                  onChange={(event) => updateTradeDraft("currency", event.target.value)}
                  aria-label="交易币种"
                >
                  {HOLDING_CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="is-number">
                <span>数量 / 份额</span>
                <Input
                  name="tradeQuantity"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={tradeDraft.quantity}
                  onChange={(event) => updateTradeDraft("quantity", event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="is-number">
                <span>成交价</span>
                <Input
                  name="tradePrice"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={tradeDraft.price}
                  onChange={(event) => updateTradeDraft("price", event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="is-number">
                <span>费用</span>
                <Input
                  name="tradeFee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={tradeDraft.fee}
                  onChange={(event) => updateTradeDraft("fee", event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="is-wide">
                <span>备注</span>
                <Textarea
                  name="tradeNotes"
                  value={tradeDraft.notes}
                  onChange={(event) => updateTradeDraft("notes", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 定投、回撤加仓、止盈、调仓…"
                />
              </label>
            </div>

            <DialogFooter className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>
                {errorMessage || "交易记录只用于习惯画像，不会自动修改持仓数量。"}
              </p>
              <Button type="submit" className="primary-action-button">
                <Save aria-hidden="true" />
                保存交易
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SummaryCard({
  detail,
  icon,
  label,
  title,
  tone = "neutral",
  value,
}: {
  detail?: string;
  icon: React.ReactNode;
  label: string;
  title?: string;
  tone?: "neutral" | "positive" | "caution" | "negative";
  value: string;
}) {
  return (
    <Card size="sm" className={`holdings-summary-card is-${tone}`} title={title}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </Card>
  );
}

function HoldingDetailPanel({
  action,
  advice,
  band,
  generating,
  holding,
  onDelete,
  onEdit,
  onGenerateProfile,
  positionPlan,
}: {
  action?: PositionPlanAction;
  advice: HoldingAdviceView | null;
  band: ReturnType<typeof targetBandForHolding> | null;
  generating: boolean;
  holding: HoldingView | null;
  onDelete: (holding: HoldingRecord) => void;
  onEdit: (holding: HoldingRecord) => void;
  onGenerateProfile: (holding: HoldingRecord) => void;
  positionPlan: PositionPlan;
}) {
  if (!holding || !advice || !band) {
    return (
      <Card size="sm" className="holding-detail-panel is-empty" aria-label="资产详情">
        <strong>选择资产</strong>
        <span>点击左侧资产查看详细建议。</span>
      </Card>
    );
  }

  const targetCopy = band.target > 0 ? band.label : isCashHolding(holding) ? `>=${formatNumber(positionPlan.policy.minCashWeight, 0)}%` : "未设置";
  const pnlCopy = formatPercent(holding.pnlPct) || "等待成本";

  return (
    <Card size="sm" className={`holding-detail-panel is-${advice.tone}`} aria-label={`${holding.symbol} 资产详情`}>
      <div className="holding-detail-head">
        <div className="holding-detail-identity">
          <span className={`holding-role-chip is-${holding.role}`}>{holdingRoleLabel(holding.role)}</span>
          <h3 translate="no">{holding.symbol}</h3>
          <p>{holding.name}</p>
        </div>
        <div className="holding-detail-actions">
          {holding.assetType === "fund" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={`holding-profile-button ${holding.profileKey ? "is-linked" : ""}`}
                  aria-label={`同步 ${holding.symbol} 基金资料与 Profile`}
                  disabled={generating}
                  onClick={() => onGenerateProfile(holding)}
                >
                  <Sparkles aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>同步基金资料与 Profile</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑 ${holding.symbol}`} onClick={() => onEdit(holding)}>
                <Pencil aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>编辑资产</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="destructive" size="icon-sm" aria-label={`删除 ${holding.symbol}`} onClick={() => onDelete(holding)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除资产</TooltipContent>
          </Tooltip>
        </div>
        <div className="holding-detail-summary">
          <span>{holding.market} · {holdingAssetTypeLabel(holding.assetType)} · {holdingQuoteSourceLabel(holding.quoteSource)}</span>
          <strong>{action?.detail ?? action?.reason ?? "按当前仓位规则"}</strong>
        </div>
      </div>

      <Separator className="holding-detail-separator" />

      <div className="holding-detail-metrics">
        <article>
          <span>市值</span>
          <strong>{holding.marketValue > 0 ? formatCurrency(holding.marketValue, holding.currency) : "—"}</strong>
        </article>
        <article>
          <span>仓位</span>
          <strong>{holding.role === "real" ? `${formatNumber(holding.weight, 1)}%` : "—"}</strong>
        </article>
        <article>
          <span>目标带</span>
          <strong>{targetCopy}</strong>
        </article>
        <article>
          <span>盈亏</span>
          <strong>{pnlCopy}</strong>
        </article>
      </div>

      <HoldingBandMeter band={band} currentWeight={holding.role === "real" ? holding.weight : 0} tone={advice.tone} />

      <div className="holding-detail-callout">
        <span>{advice.action}</span>
        <strong>{advice.amount}</strong>
        <p>{advice.reason}</p>
      </div>

      <div className="holding-horizon-grid" aria-label="短中长期建议">
        <HoldingHorizonCard label="短期" horizon={advice.short} />
        <HoldingHorizonCard label="中期" horizon={advice.medium} />
        <HoldingHorizonCard label="长期" horizon={advice.long} />
      </div>

    </Card>
  );
}

function HoldingHorizonCard({ horizon, label }: { horizon: HoldingHorizonAdvice; label: string }) {
  return (
    <article className={`is-${horizon.tone}`} title={horizon.detail}>
      <span>{label}</span>
      <strong>{horizon.label}</strong>
      <em>{horizon.detail}</em>
    </article>
  );
}

function HoldingBandMeter({
  band,
  currentWeight,
  tone,
}: {
  band: ReturnType<typeof targetBandForHolding>;
  currentWeight: number;
  tone: PositionPlanAction["tone"];
}) {
  const hasBand = band.target > 0;
  const scale = Math.max(10, band.max, band.target, currentWeight);
  const minPct = hasBand ? clampPercent((band.min / scale) * 100) : 0;
  const maxPct = hasBand ? clampPercent((band.max / scale) * 100) : 0;
  const targetPct = hasBand ? clampPercent((band.target / scale) * 100) : 0;
  const currentPct = clampPercent((Math.max(0, currentWeight) / scale) * 100);
  const style = {
    "--band-current": `${currentPct}%`,
    "--band-min": `${minPct}%`,
    "--band-target": `${targetPct}%`,
    "--band-width": `${Math.max(1.5, maxPct - minPct)}%`,
  } as CSSProperties;

  return (
    <div className={`holding-band-meter is-${tone} ${hasBand ? "" : "is-unset"}`} style={style}>
      <div className="holding-band-meter-head">
        <span>目标带</span>
        <strong>{hasBand ? band.label : "未设置"}</strong>
      </div>
      <div className="holding-band-track" aria-label={`当前仓位 ${formatNumber(currentWeight, 1)}%`}>
        {hasBand ? <i className="holding-band-range" /> : null}
        {hasBand ? <i className="holding-band-target" /> : null}
        <b className="holding-band-current" />
      </div>
      <div className="holding-band-scale" aria-hidden="true">
        <span>0%</span>
        <span>{formatNumber(scale, 0)}%</span>
      </div>
    </div>
  );
}

function policyToDraft(policy: PositionPolicy): PolicyDraft {
  const normalized = normalizePositionPolicy(policy);
  return {
    minCashWeight: String(normalized.minCashWeight),
    singleAssetCap: String(normalized.singleAssetCap),
    maxSingleAddWeight: String(normalized.maxSingleAddWeight),
  };
}

function policyFromDraft(draft: PolicyDraft): { ok: true; policy: PositionPolicy } | { ok: false; message: string } {
  const minCashWeight = parseDraftNumber(draft.minCashWeight);
  const singleAssetCap = parseDraftNumber(draft.singleAssetCap);
  const maxSingleAddWeight = parseDraftNumber(draft.maxSingleAddWeight);
  if (minCashWeight < 0 || minCashWeight > 80) {
    return { ok: false, message: "现金下限需要在 0%-80% 之间。" };
  }
  if (singleAssetCap < 1 || singleAssetCap > 100) {
    return { ok: false, message: "单只上限需要在 1%-100% 之间。" };
  }
  if (maxSingleAddWeight < 0.1 || maxSingleAddWeight > 50) {
    return { ok: false, message: "单次加仓需要在 0.1%-50% 之间。" };
  }
  if (maxSingleAddWeight > singleAssetCap) {
    return { ok: false, message: "单次加仓不能高于单只上限。" };
  }
  return {
    ok: true,
    policy: normalizePositionPolicy({
      minCashWeight,
      singleAssetCap,
      maxSingleAddWeight,
    }),
  };
}

function createTradeFromDraft(draft: TradeDraft): { ok: true; trade: TradeRecord } | { ok: false; message: string } {
  const symbol = draft.symbol.trim().toUpperCase();
  const name = draft.name.trim();
  const quantity = parseDraftNumber(draft.quantity);
  const price = parseDraftNumber(draft.price);
  const fee = parseDraftNumber(draft.fee);
  const currency = draft.currency.trim().toUpperCase();
  const tradeDate = draft.tradeDate.trim();

  if (!symbol) return { ok: false, message: "请先填写交易代码。" };
  if (!name) return { ok: false, message: "请先填写交易名称。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return { ok: false, message: "交易日期需要使用 YYYY-MM-DD。" };
  }
  if (quantity <= 0 || price <= 0) {
    return { ok: false, message: "交易数量和成交价需要大于 0。" };
  }
  if (fee < 0) {
    return { ok: false, message: "交易费用不能为负数。" };
  }

  return {
    ok: true,
    trade: {
      id: createTradeId(),
      symbol,
      name,
      side: draft.side,
      tradeDate,
      quantity,
      price,
      fee,
      currency,
      notes: draft.notes.trim(),
    },
  };
}

function createHoldingFromDraft(
  draft: HoldingDraft,
  editingId: string | null,
  existing?: HoldingRecord,
): { ok: true; holding: HoldingRecord } | { ok: false; message: string } {
  const symbol = draft.symbol.trim().toUpperCase();
  const name = draft.name.trim();
  const quantity = parseDraftNumber(draft.quantity);
  const costPrice = parseDraftNumber(draft.costPrice);
  const currentPrice = parseDraftNumber(draft.currentPrice);
  const targetMinWeight = parseDraftNumber(draft.targetMinWeight);
  const targetWeight = parseDraftNumber(draft.targetWeight);
  const targetMaxWeight = parseDraftNumber(draft.targetMaxWeight);

  if (!symbol) {
    return { ok: false, message: "请先填写资产代码。" };
  }
  if (!name) {
    return { ok: false, message: "请先填写资产名称。" };
  }
  if (draft.role === "real" && (quantity <= 0 || currentPrice <= 0)) {
    return { ok: false, message: "真实持仓需要填写大于 0 的数量和现价。" };
  }
  if ([targetMinWeight, targetWeight, targetMaxWeight].some((value) => value > 100)) {
    return { ok: false, message: "仓位区间不能超过 100%。" };
  }
  if ((targetMinWeight > 0 || targetMaxWeight > 0) && targetWeight <= 0) {
    return { ok: false, message: "填写区间时需要先设置目标仓位。" };
  }
  if (targetWeight > 0 && targetMinWeight > 0 && targetMinWeight > targetWeight) {
    return { ok: false, message: "最小仓位不能高于目标仓位。" };
  }
  if (targetWeight > 0 && targetMaxWeight > 0 && targetMaxWeight < targetWeight) {
    return { ok: false, message: "最大仓位不能低于目标仓位。" };
  }

  return {
    ok: true,
    holding: {
      id: editingId ?? createHoldingId(),
      symbol,
      name,
      market: draft.market,
      currency: draft.currency,
      role: draft.role,
      assetType: draft.assetType,
      quoteSource: draft.quoteSource,
      quantity,
      costPrice,
      currentPrice,
      targetMinWeight: targetMinWeight > 0 ? targetMinWeight : undefined,
      targetWeight,
      targetMaxWeight: targetMaxWeight > 0 ? targetMaxWeight : undefined,
      notes: draft.notes.trim(),
      profileKey: existing?.profileKey,
    },
  };
}

function summarizeHoldings(rows: HoldingView[]) {
  const realRows = rows.filter((row) => row.role === "real");
  const totalMarketValue = realRows.reduce((sum, row) => sum + row.marketValue, 0);
  const totalCostValue = realRows.reduce((sum, row) => sum + row.costValue, 0);
  const pnl = totalMarketValue - totalCostValue;
  const pnlPct = totalCostValue > 0 ? (pnl / totalCostValue) * 100 : null;
  const drift = realRows
    .filter((row) => row.drift !== null)
    .reduce((sum, row) => sum + Math.abs(row.drift ?? 0), 0);

  return {
    driftLabel: drift > 0 ? `${formatNumber(drift, 1)}%` : "—",
    marketValueLabel: formatCurrencyGroups(realRows),
    pnl,
    pnlLabel: totalCostValue > 0 ? formatCurrency(pnl, dominantCurrency(realRows)) : "—",
    pnlPctLabel: pnlPct === null ? "等待成本价" : formatPercent(pnlPct),
    fundCount: rows.filter((row) => row.assetType === "fund").length,
    proxyCount: rows.filter((row) => row.role === "proxy").length,
    realCount: realRows.length,
    securityCount: rows.filter((row) => row.assetType === "stock" || row.assetType === "etf").length,
    watchCount: rows.filter((row) => row.role === "watch").length,
  };
}

function holdingAdviceFor(
  holding: HoldingView,
  action: PositionPlanAction | undefined,
  band: ReturnType<typeof targetBandForHolding>,
  plan: PositionPlan,
  decision?: AssetDecision,
): HoldingAdviceView {
  const isCash = holding.assetType === "cash";
  const targetLabel = isCash
    ? `${formatNumber(plan.decision.cashDecision.targetMinWeight, 0)}%-${formatNumber(plan.decision.cashDecision.targetMaxWeight, 0)}%`
    : band.target > 0
      ? band.label
      : "未设置";

  if (isCash) {
    const cash = plan.decision.cashDecision;
    const executionLabel = executionStateLabel(plan.decision.executionState);
    const todayAmount = plan.decision.executableBudget > 0 ? signedCurrency(plan.decision.executableBudget, plan.currency, "reduce") : "¥0";
    const shortAmount = plan.decision.triggerBudget > 0 ? signedCurrency(plan.decision.triggerBudget, plan.currency, "reduce") : "¥0";
    const pending = cash.excessCashToUpper > 0 ? signedCurrency(cash.excessCashToUpper, plan.currency, "reduce") : "¥0";
    const available = cash.maxSpendUntilCashMin > 0 ? signedCurrency(cash.maxSpendUntilCashMin, plan.currency, "reduce") : "¥0";
    return {
      action: cash.label,
      amount: todayAmount,
      amountTone: plan.decision.executableBudget > 0 ? "negative" : cash.tone,
      delta: `${formatNumber(plan.cashWeight, 1)}% / ${targetLabel}`,
      longAmount: available,
      longTone: cash.maxSpendUntilCashMin > 0 ? "negative" : "neutral",
      maxAmount: available,
      maxTone: cash.maxSpendUntilCashMin > 0 ? "negative" : "neutral",
      midAmount: pending,
      midTone: cash.excessCashToUpper > 0 ? "negative" : "neutral",
      reason: reasonCodesText(cash.reasonCodes),
      short: { label: cash.excessCashToUpper > 0 ? "触发部署" : "目标内", detail: `0-2 周 · ${shortAmount}`, tone: cash.tone },
      shortAmount,
      shortTone: plan.decision.triggerBudget > 0 ? "negative" : cash.tone,
      medium: { label: "可动用", detail: `2-12 周 · ${available}`, tone: cash.tone },
      long: { label: executionLabel, detail: `3-12 个月 · 目标 ${formatNumber(cash.targetMinWeight, 0)}%-${formatNumber(cash.targetMaxWeight, 0)}%`, tone: plan.statusTone },
      state: executionLabel,
      tone: cash.tone,
    };
  }

  if (decision) {
    const tone = assetDecisionTone(decision);
    const reduceIntent = decision.intent === "TRIM_OVERWEIGHT";
    const today = decision.todayAmount > 0 ? signedCurrency(decision.todayAmount, holding.currency, reduceIntent ? "reduce" : "add") : "¥0";
    const shortAmount = decision.triggerAmount > 0 ? signedCurrency(decision.triggerAmount, holding.currency, reduceIntent ? "reduce" : "add") : "¥0";
    const midAmount = reduceIntent
      ? decision.pendingAmount > 0
        ? signedCurrency(decision.pendingAmount, holding.currency, "reduce")
        : "¥0"
      : signedCurrency(decision.headroomToMid, holding.currency, "add");
    const maxAmount = reduceIntent ? "¥0" : signedCurrency(decision.headroomToMax, holding.currency, "add");
    const state = executionStateLabel(decision.executionState);
    const intent = intentLabel(decision.intent, decision.executionState, holding.assetType);
    const reason = reasonCodesText(decision.reasonCodes);
    return {
      action: intent,
      amount: today,
      amountTone: decision.todayAmount > 0 ? tone : decision.executionState === "EXECUTABLE" ? "neutral" : tone,
      delta: state,
      longAmount: maxAmount,
      longTone: reduceIntent || decision.headroomToMax <= 0 ? "neutral" : tone,
      maxAmount,
      maxTone: reduceIntent || decision.headroomToMax <= 0 ? "neutral" : tone,
      midAmount,
      midTone: reduceIntent ? "negative" : decision.headroomToMid > 0 ? tone : "neutral",
      reason,
      short: { label: decision.todayAmount > 0 ? "今日执行" : "触发候选", detail: `0-2 周 · ${shortAmount}`, tone },
      shortAmount,
      shortTone: decision.triggerAmount > 0 ? tone : decision.executionState === "BLOCKED_BY_RISK" ? "caution" : "neutral",
      medium: { label: "补中位", detail: `2-12 周 · ${midAmount}`, tone: decision.headroomToMid > 0 ? tone : "neutral" },
      long: { label: "到上限空间", detail: `3-12 个月 · ${maxAmount}`, tone: decision.headroomToMax > 0 ? "neutral" : "caution" },
      state,
      tone,
    };
  }

  if (!action) {
    const hasTargetBand = band.target > 0;
    return {
      action: holding.role === "real" ? "今日不动" : "不计仓位",
      amount: "¥0",
      amountTone: "neutral",
      delta: targetLabel,
      longAmount: "—",
      longTone: "neutral",
      maxAmount: "—",
      maxTone: "neutral",
      midAmount: "—",
      midTone: "neutral",
      reason: holding.role === "real" ? "未触发加减仓条件" : "代理/观察资产",
      short: { label: "今日不动", detail: "0-2 周", tone: "neutral" },
      shortAmount: "¥0",
      shortTone: "neutral",
      medium: { label: hasTargetBand ? "维持区间" : targetLabel, detail: `2-12 周 · ${targetLabel}`, tone: "neutral" },
      long: { label: hasTargetBand ? "守住目标带" : "复核配置", detail: `3-12 个月 · ${targetLabel}`, tone: "neutral" },
      state: "未触发",
      tone: "neutral",
    };
  }

  const buyVerb = holding.assetType === "fund" ? "申购" : "买入";
  const sellVerb = holding.assetType === "fund" ? "赎回" : "卖出";
  const buyPlanLabel = holding.assetType === "fund" ? "定投" : "买入";
  const delta = action.weightLabel !== "—" ? action.weightLabel : targetLabel;
  const isAdd = action.weightDelta > 0 && action.amount > 0;
  const isReduce = action.weightDelta < 0;
  const amount = action.amount > 0 ? signedCurrency(action.amount, holding.currency, isReduce ? "reduce" : "add") : "¥0";
  const isPaused = action.action === "暂停定投" || action.action === "预算不足" || action.action === "补现金后加";
  const isHold = action.action === "继续持有";
  const pausedShortLabel =
    action.action === "预算不足" ? "预算不足" : action.action === "补现金后加" ? "先补现金" : "暂停新增";
  const pausedMediumLabel =
    action.action === "预算不足" ? "等预算释放" : action.action === "补现金后加" ? "补现金后加" : "等风险门";
  const todayAction = isReduce
    ? `今日${sellVerb}`
    : isAdd
      ? action.action === "可小加"
        ? holding.assetType === "fund"
          ? "小额定投"
          : "小额买入"
        : `计划${buyVerb}`
      : isPaused
        ? action.action
        : isHold
          ? "今日不动"
          : action.action;
  const shortLabel = isReduce
    ? `先${sellVerb}`
    : isAdd
      ? action.action === "可小加"
        ? holding.assetType === "fund"
          ? "小额定投"
          : "小额买入"
        : buyPlanLabel
      : isPaused
        ? pausedShortLabel
        : isHold
          ? "今日不动"
          : action.action;
  const mediumLabel = isReduce
    ? "降回上限"
    : isAdd
      ? "分批到中枢"
    : action.action === "设置计划"
        ? "补目标带"
        : isPaused
          ? pausedMediumLabel
          : "维持区间";
  const longLabel =
    action.action === "设置计划" ? "建立目标带" : isReduce ? "回到目标带" : isAdd ? "接近目标带" : band.target > 0 ? "守住目标带" : "复核配置";

  return {
    action: todayAction,
    amount,
    amountTone: action.amount > 0 ? action.tone : "neutral",
    delta,
    longAmount: "—",
    longTone: "neutral",
    maxAmount: "—",
    maxTone: "neutral",
    midAmount: "—",
    midTone: "neutral",
    reason: compactTableText(action.detail || action.reason),
    short: { label: shortLabel, detail: `0-2 周 · ${isAdd || isReduce ? amount : compactTableText(action.reason)}`, tone: action.tone },
    shortAmount: amount,
    shortTone: action.amount > 0 ? action.tone : "neutral",
    medium: { label: mediumLabel, detail: `2-12 周 · ${targetLabel}`, tone: isReduce ? "caution" : action.tone },
    long: { label: longLabel, detail: `3-12 个月 · ${targetLabel}`, tone: action.action === "设置计划" ? "caution" : "neutral" },
    state: action.action,
    tone: action.tone,
  };
}

function executionStateLabel(state: ExecutionState) {
  switch (state) {
    case "EXECUTABLE":
      return "可执行";
    case "BLOCKED_BY_PROFILE":
      return "配置阻断";
    case "BLOCKED_BY_RISK":
      return "风险门未开";
    case "BLOCKED_BY_SCHEDULE":
      return "非计划日";
    case "BLOCKED_BY_DATA":
      return "数据待更新";
    case "NO_BUDGET":
      return "预算不足";
    case "NO_HEADROOM":
      return "无空间";
    case "PAUSED":
      return "已暂停";
    default:
      return "待确认";
  }
}

function profileHealthLabel(profileHealth: PositionPlan["decision"]["profileHealth"]) {
  if (profileHealth.level === "error") return "配置错误";
  if (profileHealth.level === "warning") return "配置缺口";
  return "覆盖完整";
}

function profileHealthTone(profileHealth: PositionPlan["decision"]["profileHealth"]): PositionPlanAction["tone"] {
  if (profileHealth.level === "error") return "negative";
  if (profileHealth.level === "warning") return "caution";
  return "positive";
}

function intentLabel(intent: RecommendationIntent, state: ExecutionState, assetType: HoldingAssetType | undefined) {
  const buyLabel = assetType === "fund" ? "定投" : "买入";
  if (state !== "EXECUTABLE") {
    if (intent === "ADD_TO_TARGET" || intent === "DEPLOY_EXCESS_CASH" || intent === "REBALANCE_TO_BAND") return "待触发加仓";
    if (intent === "CONFIG_REQUIRED") return "补配置";
  }
  switch (intent) {
    case "DEPLOY_EXCESS_CASH":
      return "部署现金";
    case "ADD_TO_TARGET":
      return `${buyLabel}到目标`;
    case "REBALANCE_TO_BAND":
      return "再平衡";
    case "TRIM_OVERWEIGHT":
      return "超配减仓";
    case "REDUCE_RISK":
      return "降低风险";
    case "WAIT_FOR_TRIGGER":
      return "等触发";
    case "CONFIG_REQUIRED":
      return "补配置";
    case "HOLD":
    default:
      return "持有观察";
  }
}

function assetDecisionTone(decision: AssetDecision): PositionPlanAction["tone"] {
  if (decision.intent === "TRIM_OVERWEIGHT") return "negative";
  if (decision.executionState === "BLOCKED_BY_PROFILE" || decision.executionState === "BLOCKED_BY_RISK") return "caution";
  if (decision.executionState === "EXECUTABLE" && decision.todayAmount > 0) return "positive";
  if (decision.executionState === "NO_BUDGET" || decision.executionState === "NO_HEADROOM") return "caution";
  return "neutral";
}

const HOLDING_TABLE_REASON_TEXT: Partial<Record<ReasonCode, string>> = {
  TARGET_MIN_SUM_GT_100: "配置错误",
  TARGET_MAX_SUM_LT_100: "配置缺口",
  CASH_OVER_TARGET: "现金超配",
  CASH_BELOW_TARGET: "现金不足",
  CASH_WITHIN_TARGET: "现金正常",
  ASSET_WITHIN_BAND: "区间内",
  ASSET_BELOW_MID: "低于中位",
  ASSET_BELOW_MIN: "低于下限",
  ASSET_OVER_MAX: "超目标上限",
  RISK_GATE_CLOSED: "风险门未开",
  MARKET_RISK_HIGH: "风险偏高",
  NO_CASH_INSTRUMENT: "缺现金",
  NO_BUDGET: "预算不足",
  NO_HEADROOM: "无空间",
  NO_ASSET_CAPACITY: "容量不足",
  CONFIG_REQUIRED: "补配置",
};

function reasonCodesText(codes: ReasonCode[]) {
  const text = codes.map((code) => HOLDING_TABLE_REASON_TEXT[code] || POSITION_REASON_TEXT[code]).filter(Boolean);
  if (!text.length) return "按当前规则";
  return compactTableText(text.slice(0, 3).join(" / "));
}

function toHoldingView(holding: HoldingRecord, realTotal: number): HoldingView {
  const marketValue = valueOf(holding);
  const costValue = holding.quantity * holding.costPrice;
  const pnl = marketValue - costValue;
  const pnlPct = costValue > 0 ? (pnl / costValue) * 100 : null;
  const weight = holding.role === "real" && realTotal > 0 ? (marketValue / realTotal) * 100 : 0;
  const drift = holding.role === "real" && holding.targetWeight > 0 ? weight - holding.targetWeight : null;

  return { ...holding, costValue, drift, marketValue, pnl, pnlPct, weight };
}

function valueOf(holding: HoldingRecord) {
  return holding.quantity * holding.currentPrice;
}

function dominantCurrency(rows: HoldingRecord[]) {
  return rows[0]?.currency || "CNY";
}

function fundSeedNote(manager: string, issuer: string, sourceName: string) {
  const details = [
    manager ? `基金经理：${manager}` : "",
    issuer ? `管理人：${issuer}` : "",
    sourceName ? `来源：${sourceName}` : "",
  ].filter(Boolean);
  return details.join(" · ");
}

function compactTableText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function formatCurrencyGroups(rows: HoldingView[]) {
  if (!rows.length) return "—";
  const totals = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.currency] = (acc[row.currency] ?? 0) + row.marketValue;
    return acc;
  }, {});
  return Object.entries(totals)
    .map(([currency, value]) => formatCurrency(value, currency))
    .join(" / ");
}

function parseDraftNumber(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    signDisplay: "exceptZero",
    style: "percent",
  }).format(value / 100);
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function signedCurrency(value: number, currency: string, direction: "add" | "reduce") {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return formatCurrency(0, currency);
  const prefix = direction === "reduce" ? "-" : "+";
  return `${prefix}${formatCurrency(Math.abs(value), currency)}`;
}

function createHoldingId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `holding-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createTradeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}
