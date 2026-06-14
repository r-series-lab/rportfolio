import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import WorkspacesRoundedIcon from "@mui/icons-material/WorkspacesRounded";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
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
  targetBandForHolding,
  type PositionPlan,
  type PositionPlanAction,
  type PositionPolicy,
} from "../lib/position-plan";
import type { ProfileSummary } from "../lib/types";
import {
  type TradeRecord,
  type TradeSide,
} from "../lib/trades";
import { EChart, type RPortfolioChartOption } from "./echart";

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
  delta: string;
  long: HoldingHorizonAdvice;
  medium: HoldingHorizonAdvice;
  reason: string;
  short: HoldingHorizonAdvice;
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
  const stats = useMemo(() => summarizeHoldings(rows), [rows]);
  const selectedHolding = useMemo(
    () => rows.find((row) => row.id === selectedHoldingId) ?? rows[0] ?? null,
    [rows, selectedHoldingId],
  );
  const selectedHoldingBand = selectedHolding ? targetBandForHolding(selectedHolding, positionPlan.policy) : null;
  const selectedHoldingAction = selectedHolding ? actionByHoldingId.get(selectedHolding.id) : undefined;
  const selectedHoldingAdvice =
    selectedHolding && selectedHoldingBand ? holdingAdviceFor(selectedHolding, selectedHoldingAction, selectedHoldingBand, positionPlan) : null;

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
      return;
    }
    onTradesChange((current) => [parsed.trade, ...current]);
    setTradeOpen(false);
    setTradeDraft(EMPTY_TRADE_DRAFT);
    setStatusMessage(`已记录 ${parsed.trade.symbol} ${parsed.trade.side === "buy" ? "买入" : "卖出"}。`);
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
      return;
    }
    onPositionPolicyChange(parsed.policy);
    setPolicyOpen(false);
    setStatusMessage("已更新仓位规则。");
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
  };

  const generateProfileForHolding = async (holding: HoldingRecord) => {
    if ((holding.assetType ?? "stock") !== "fund") {
      setStatusMessage("只有基金持仓可以直接生成基金 Profile。");
      return;
    }
    const code = holding.symbol.trim();
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("基金 Profile 生成需要 6 位公募基金代码。");
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "同步失败。");
      setStatusMessage("同步失败。");
    } finally {
      setProfileGeneratingId(null);
    }
  };

  const lookupFund = async () => {
    const code = draft.symbol.trim();
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage("基金识别需要 6 位公募基金代码。");
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "基金识别失败。");
      setStatusMessage("基金识别失败。");
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
          <SummaryCard icon={<ShieldRoundedIcon fontSize="inherit" />} label="真实市值" value={stats.marketValueLabel} title="代理和观察资产不计入" />
          <SummaryCard
            icon={<WorkspacesRoundedIcon fontSize="inherit" />}
            label="现金缓冲"
            value={positionPlan.hasCashInstrument ? `${formatNumber(positionPlan.cashWeight, 1)}%` : "未记录"}
            detail={positionPlan.hasCashInstrument ? formatCurrency(positionPlan.cashValue, positionPlan.currency) : "需添加现金"}
            tone={positionPlan.hasCashInstrument && positionPlan.cashWeight >= positionPlan.policy.minCashWeight ? "positive" : "caution"}
          />
          <SummaryCard
            icon={<VisibilityRoundedIcon fontSize="inherit" />}
            label="可加预算"
            value={positionPlan.addableBudgetLabel}
            detail={`现金下限 ${formatNumber(positionPlan.policy.minCashWeight, 0)}% · 单次 ${formatNumber(positionPlan.policy.maxSingleAddWeight, 0)}%`}
            tone={positionPlan.statusTone === "positive" && positionPlan.addableBudget > 0 ? "positive" : positionPlan.statusTone}
          />
          <SummaryCard
            icon={<WorkspacesRoundedIcon fontSize="inherit" />}
            label="仓位状态"
            value={positionPlan.statusLabel}
            title={positionPlan.summary}
            tone={positionPlan.statusTone}
          />
        </div>

        {rows.length ? <PositionMapPanel plan={positionPlan} rows={rows} /> : null}

        <div className="holdings-workbench">
          <div className="holdings-grid">
            <section className="holdings-list-card" aria-labelledby="holdings-list-title">
              <div className="holding-card-head">
                <div>
                  <h2 id="holdings-list-title">资产列表</h2>
                </div>
                <div className="holding-list-actions">
                  {statusMessage ? <p aria-live="polite">{statusMessage}</p> : null}
                  <button type="button" className="icon-text-button" onClick={openPolicy}>
                    <TuneRoundedIcon fontSize="inherit" />
                    规则
                  </button>
                  <button type="button" className="icon-text-button" onClick={openTrade}>
                    <AddRoundedIcon fontSize="inherit" />
                    交易
                  </button>
                  <button type="button" className="icon-text-button" onClick={openCreate}>
                    <AddRoundedIcon fontSize="inherit" />
                    添加
                  </button>
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
                          <th scope="col">建议</th>
                          {rightRailCollapsed ? <th scope="col">操作</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((holding) => {
                          const action = actionByHoldingId.get(holding.id);
                          const band = targetBandForHolding(holding, positionPlan.policy);
                          const advice = holdingAdviceFor(holding, action, band, positionPlan);
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
                              <td className={`holding-advice-cell is-${advice.tone}`} title={advice.reason}>
                                <strong>{advice.action}</strong>
                                <small>{advice.amount}</small>
                              </td>
                              {rightRailCollapsed ? (
                                <td className="holding-row-actions" aria-label={`${holding.symbol} 操作`}>
                                  <div>
                                    {holding.assetType === "fund" ? (
                                      <button
                                        type="button"
                                        className={`holding-profile-button ${holding.profileKey ? "is-linked" : ""}`}
                                        aria-label={`同步 ${holding.symbol} 基金资料与 Profile`}
                                        title="同步基金资料与 Profile"
                                        disabled={profileGeneratingId === holding.id}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void generateProfileForHolding(holding);
                                        }}
                                      >
                                        <AutoAwesomeRoundedIcon fontSize="inherit" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      aria-label={`编辑 ${holding.symbol}`}
                                      title="编辑"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        startEdit(holding);
                                      }}
                                    >
                                      <EditRoundedIcon fontSize="inherit" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`删除 ${holding.symbol}`}
                                      title="删除"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        deleteHolding(holding);
                                      }}
                                    >
                                      <DeleteOutlineRoundedIcon fontSize="inherit" />
                                    </button>
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
            </section>
          </div>
        </div>
      </div>

      {!rightRailCollapsed ? (
        <aside className="holdings-detail-rail" aria-label="资产详情">
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

      {formOpen ? (
        <div className="holding-form-layer" role="presentation">
          <button type="button" className="holding-form-backdrop" aria-label="关闭持仓编辑弹窗" onClick={closeForm} />
          <form
            className="holding-form-card holding-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="holding-form-title"
            onSubmit={submitDraft}
          >
            <div className="holding-card-head">
              <div>
                <span>{editingId ? "Edit Asset" : "New Asset"}</span>
                <h2 id="holding-form-title">{editingId ? "编辑资产" : "添加资产"}</h2>
              </div>
              <div className="holding-dialog-actions">
                <button type="button" className="icon-text-button" onClick={resetDraft}>
                  <RestartAltRoundedIcon fontSize="inherit" />
                  重置
                </button>
                <button type="button" className="holding-dialog-close" aria-label="关闭持仓编辑弹窗" onClick={closeForm}>
                  <CloseRoundedIcon fontSize="inherit" />
                </button>
              </div>
            </div>

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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <textarea
                  name="holdingNotes"
                  value={draft.notes}
                  onChange={(event) => updateDraft("notes", event.target.value)}
                  autoComplete="off"
                  placeholder={draft.assetType === "fund" ? "例如 消费主动基金，跟踪季报持仓…" : "例如 用作 AI 半导体主线真实仓位…"}
                />
              </label>
            </div>

            <div className="holding-form-tools">
              <button
                type="button"
                className="icon-text-button"
                onClick={() => void lookupFund()}
                disabled={fundLookupLoading || draft.assetType !== "fund"}
              >
                <SearchRoundedIcon fontSize="inherit" />
                {fundLookupLoading ? "识别中" : "识别基金"}
              </button>
              <p>基金模式可用东方财富 / 天天基金公开资料预填名称和净值；非基金持仓保持手动维护。</p>
            </div>

            <div className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>{errorMessage || statusMessage || persistenceMessage}</p>
              <button type="submit" className="primary-action-button">
                {editingId ? <SaveRoundedIcon fontSize="inherit" /> : <AddRoundedIcon fontSize="inherit" />}
                {editingId ? "保存持仓" : "添加持仓"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {policyOpen ? (
        <div className="holding-form-layer" role="presentation">
          <button type="button" className="holding-form-backdrop" aria-label="关闭仓位规则弹窗" onClick={closePolicy} />
          <form
            className="holding-form-card holding-form-dialog position-policy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="position-policy-title"
            onSubmit={submitPolicy}
          >
            <div className="holding-card-head">
              <div>
                <span>Position Rules</span>
                <h2 id="position-policy-title">仓位规则</h2>
              </div>
              <div className="holding-dialog-actions">
                <button type="button" className="icon-text-button" onClick={resetPolicy}>
                  <RestartAltRoundedIcon fontSize="inherit" />
                  默认
                </button>
                <button type="button" className="holding-dialog-close" aria-label="关闭仓位规则弹窗" onClick={closePolicy}>
                  <CloseRoundedIcon fontSize="inherit" />
                </button>
              </div>
            </div>

            <div className="position-policy-grid">
              <label className="is-number">
                <span>现金下限</span>
                <input
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
                <input
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
                <input
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

            <div className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>{errorMessage || "规则会同时影响持仓页和组合分析页。"}</p>
              <button type="submit" className="primary-action-button">
                <SaveRoundedIcon fontSize="inherit" />
                保存规则
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {tradeOpen ? (
        <div className="holding-form-layer" role="presentation">
          <button type="button" className="holding-form-backdrop" aria-label="关闭交易记录弹窗" onClick={closeTrade} />
          <form
            className="holding-form-card holding-form-dialog trade-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-form-title"
            onSubmit={submitTrade}
          >
            <div className="holding-card-head">
              <div>
                <span>Trade Journal</span>
                <h2 id="trade-form-title">记录交易</h2>
              </div>
              <button type="button" className="holding-dialog-close" aria-label="关闭交易记录弹窗" onClick={closeTrade}>
                <CloseRoundedIcon fontSize="inherit" />
              </button>
            </div>

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
                <input
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
                <input
                  name="tradeName"
                  value={tradeDraft.name}
                  onChange={(event) => updateTradeDraft("name", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 银华数字经济…"
                />
              </label>
              <label>
                <span>日期</span>
                <input
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
                <input
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
                <input
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
                <input
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
                <textarea
                  name="tradeNotes"
                  value={tradeDraft.notes}
                  onChange={(event) => updateTradeDraft("notes", event.target.value)}
                  autoComplete="off"
                  placeholder="例如 定投、回撤加仓、止盈、调仓…"
                />
              </label>
            </div>

            <div className="holding-form-footer" aria-live="polite">
              <p className={errorMessage ? "is-error" : undefined}>
                {errorMessage || "交易记录只用于习惯画像，不会自动修改持仓数量。"}
              </p>
              <button type="submit" className="primary-action-button">
                <SaveRoundedIcon fontSize="inherit" />
                保存交易
              </button>
            </div>
          </form>
        </div>
      ) : null}
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
    <article className={`holdings-summary-card is-${tone}`} title={title}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  );
}

function PositionMapPanel({ plan, rows }: { plan: PositionPlan; rows: HoldingView[] }) {
  const realRows = rows.filter((row) => row.role === "real" && row.marketValue > 0);
  const riskRows = rows
    .filter((row) => row.role === "real" && !isCashHolding(row))
    .sort((left, right) => {
      const leftBand = targetBandForHolding(left, plan.policy);
      const rightBand = targetBandForHolding(right, plan.policy);
      return Math.abs((right.drift ?? right.weight - rightBand.target) || 0) - Math.abs((left.drift ?? left.weight - leftBand.target) || 0);
    })
    .slice(0, 5);
  const allocationData = allocationChartData(realRows);
  const bandRows = riskRows.map((row) => {
    const band = targetBandForHolding(row, plan.policy);
    const tone: "positive" | "neutral" | "caution" | "negative" =
      band.target <= 0 ? "neutral" : row.weight > band.max ? "negative" : row.weight < band.min ? "caution" : "positive";
    const state =
      band.target <= 0
        ? "未设置"
        : row.weight > band.max
          ? `高 ${formatNumber(row.weight - band.max, 1)}%`
          : row.weight < band.min
            ? `低 ${formatNumber(band.min - row.weight, 1)}%`
            : "区间内";
    return {
      current: roundChartValue(row.weight),
      label: band.label,
      max: band.max,
      min: band.min,
      range: Math.max(0, roundChartValue(band.max - band.min)),
      state,
      symbol: row.symbol,
      tone,
    };
  });
  const bandMax = Math.max(10, ...bandRows.map((row) => Math.max(row.current, row.max)), plan.policy.singleAssetCap * 0.45);
  const bandChartStyle = { height: `${Math.max(138, Math.min(224, 104 + bandRows.length * 28))}px` } satisfies CSSProperties;
  const allocationOption = useMemo<RPortfolioChartOption>(
    () => ({
      animationDuration: 360,
      color: allocationData.map((item) => item.itemStyle.color),
      legend: { show: false },
      series: [
        {
          avoidLabelOverlap: true,
          center: ["50%", "52%"],
          data: allocationData,
          emphasis: {
            scaleSize: 4,
          },
          itemStyle: {
            borderColor: "rgba(5, 10, 16, 0.28)",
            borderRadius: 5,
            borderWidth: 2,
          },
          label: { show: false },
          radius: ["64%", "86%"],
          type: "pie",
        },
      ],
      tooltip: {
        backgroundColor: "rgba(9, 14, 21, 0.92)",
        borderColor: "rgba(127, 159, 194, 0.18)",
        borderWidth: 1,
        confine: true,
        textStyle: { color: "#f3f7f3", fontSize: 12, fontWeight: 700 },
        trigger: "item",
      },
    }),
    [allocationData],
  );
  const bandOption = useMemo<RPortfolioChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 16, left: 48, right: 10, top: 8 },
      series: [
        {
          data: bandRows.map((row) => row.min),
          emphasis: { disabled: true },
          itemStyle: { color: "transparent" },
          name: "目标起点",
          silent: true,
          stack: "target",
          type: "bar",
        },
        {
          barWidth: 12,
          data: bandRows.map((row) => ({ value: row.range, itemStyle: { color: chartRangeColor(row.tone) } })),
          itemStyle: { borderRadius: 999, borderColor: "rgba(196, 220, 255, 0.08)", borderWidth: 1 },
          name: "目标带",
          stack: "target",
          type: "bar",
        },
        {
          data: bandRows.map((row) => ({ value: [row.current, row.symbol], itemStyle: { color: chartToneColor(row.tone) } })),
          encode: { x: 0, y: 1 },
          name: "当前",
          symbol: "rect",
          symbolSize: [4, 24],
          type: "scatter",
          z: 3,
        },
      ],
      tooltip: {
        backgroundColor: "rgba(9, 14, 21, 0.92)",
        borderColor: "rgba(127, 159, 194, 0.18)",
        borderWidth: 1,
        confine: true,
        textStyle: { color: "#f3f7f3", fontSize: 12, fontWeight: 700 },
        trigger: "axis",
      },
      xAxis: {
        axisLabel: { color: "#7f8da0", fontSize: 10, formatter: "{value}%" },
        axisLine: { show: false },
        axisTick: { show: false },
        max: roundChartAxisMax(bandMax),
        min: 0,
        splitLine: { lineStyle: { color: "rgba(127, 159, 194, 0.10)" } },
        type: "value",
      },
      yAxis: {
        axisLabel: { color: "#c8d1d8", fontSize: 11, fontWeight: 800 },
        axisLine: { show: false },
        axisTick: { show: false },
        data: bandRows.map((row) => row.symbol),
        inverse: true,
        type: "category",
      },
    }),
    [bandMax, bandRows],
  );

  return (
    <section className="position-map-panel" aria-label="仓位地图">
      <div className="position-map-head">
        <h2>仓位地图</h2>
        <span className={`is-${plan.statusTone}`}>{plan.statusLabel}</span>
      </div>

      <div className="position-chart-grid">
        <div className="position-chart-cell is-allocation">
          <div className="position-chart-title">
            <span>配置结构</span>
            <strong>{formatNumber(plan.totalValue > 0 ? (plan.cashValue / plan.totalValue) * 100 : 0, 1)}% 现金</strong>
          </div>
          <div className="position-donut-layout">
            <div className="position-donut-shell">
              <EChart className="position-chart-canvas" ariaLabel="资产配置占比图" option={allocationOption} />
              <div className="position-donut-center" aria-hidden="true">
                <strong>{formatNumber(plan.cashWeight, 1)}%</strong>
                <span>现金</span>
              </div>
            </div>
            <div className="position-chart-legend">
              {allocationData.map((item) => (
                <article key={item.name}>
                  <i style={{ background: item.itemStyle.color }} />
                  <span>{item.name}</span>
                  <strong>{formatNumber(item.percent, 1)}%</strong>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="position-chart-cell is-band">
          <div className="position-chart-title">
            <span>目标带与偏离</span>
            <strong>{bandRows.length} 项</strong>
          </div>
          {bandRows.length ? (
            <div className="position-band-layout">
              <EChart className="position-chart-canvas" style={bandChartStyle} ariaLabel="持仓目标区间图" option={bandOption} />
              <div className="position-band-summary">
                {bandRows.slice(0, 4).map((row) => (
                  <article className={`is-${row.tone}`} key={row.symbol}>
                    <strong translate="no">{row.symbol}</strong>
                    <span>{row.current}% / {row.label}</span>
                    <em>{row.state}</em>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="position-chart-empty">无风险资产</div>
          )}
        </div>
      </div>
    </section>
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
      <aside className="holding-detail-panel is-empty" aria-label="资产详情">
        <strong>选择资产</strong>
        <span>点击左侧资产查看详细建议。</span>
      </aside>
    );
  }

  const targetCopy = band.target > 0 ? band.label : isCashHolding(holding) ? `>=${formatNumber(positionPlan.policy.minCashWeight, 0)}%` : "未设置";
  const pnlCopy = formatPercent(holding.pnlPct) || "等待成本";

  return (
    <aside className={`holding-detail-panel is-${advice.tone}`} aria-label={`${holding.symbol} 资产详情`}>
      <div className="holding-detail-head">
        <div className="holding-detail-identity">
          <span className={`holding-role-chip is-${holding.role}`}>{holdingRoleLabel(holding.role)}</span>
          <h3 translate="no">{holding.symbol}</h3>
          <p>{holding.name}</p>
        </div>
        <div className="holding-detail-actions">
          {holding.assetType === "fund" ? (
            <button
              type="button"
              className={`holding-profile-button ${holding.profileKey ? "is-linked" : ""}`}
              aria-label={`同步 ${holding.symbol} 基金资料与 Profile`}
              title="同步基金资料与 Profile"
              disabled={generating}
              onClick={() => onGenerateProfile(holding)}
            >
              <AutoAwesomeRoundedIcon fontSize="inherit" />
            </button>
          ) : null}
          <button type="button" aria-label={`编辑 ${holding.symbol}`} onClick={() => onEdit(holding)}>
            <EditRoundedIcon fontSize="inherit" />
          </button>
          <button type="button" aria-label={`删除 ${holding.symbol}`} onClick={() => onDelete(holding)}>
            <DeleteOutlineRoundedIcon fontSize="inherit" />
          </button>
        </div>
        <div className="holding-detail-summary">
          <span>{holding.market} · {holdingAssetTypeLabel(holding.assetType)} · {holdingQuoteSourceLabel(holding.quoteSource)}</span>
          <strong>{action?.detail ?? action?.reason ?? "按当前仓位规则"}</strong>
        </div>
      </div>

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

    </aside>
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
): HoldingAdviceView {
  const isCash = holding.assetType === "cash";
  const targetLabel = band.target > 0 ? band.label : isCash ? `>=${formatNumber(plan.policy.minCashWeight, 0)}%` : "未设置";

  if (isCash) {
    const cashTone = plan.cashWeight >= plan.policy.minCashWeight ? "positive" : "caution";
    return {
      action: plan.cashWeight >= plan.policy.minCashWeight ? "保留缓冲" : "补现金",
      amount: plan.cashWeight >= plan.policy.minCashWeight ? "—" : plan.trimNeededLabel,
      delta: `${formatNumber(plan.cashWeight, 1)}% / ${targetLabel}`,
      reason: "用于控制加仓预算",
      short: { label: "不动用", detail: "0-2 周", tone: cashTone },
      medium: { label: `守住 ${formatNumber(plan.policy.minCashWeight, 0)}%`, detail: "2-12 周", tone: cashTone },
      long: { label: "现金底仓", detail: `3-12 个月 · ${targetLabel}`, tone: "neutral" },
      tone: cashTone,
    };
  }

  if (!action) {
    const hasTargetBand = band.target > 0;
    return {
      action: holding.role === "real" ? "观察" : "不计仓位",
      amount: "—",
      delta: targetLabel,
      reason: holding.role === "real" ? "等待规则触发" : "代理/观察资产",
      short: { label: "观察", detail: "0-2 周", tone: "neutral" },
      medium: { label: hasTargetBand ? "维持区间" : targetLabel, detail: `2-12 周 · ${targetLabel}`, tone: "neutral" },
      long: { label: hasTargetBand ? "守住目标带" : "复核配置", detail: `3-12 个月 · ${targetLabel}`, tone: "neutral" },
      tone: "neutral",
    };
  }

  const amount = action.amountLabel !== "—" ? action.amountLabel : "—";
  const delta = action.weightLabel !== "—" ? action.weightLabel : targetLabel;
  const isAdd = action.weightDelta > 0 && action.amount > 0;
  const isReduce = action.weightDelta < 0;
  const buyVerb = holding.assetType === "fund" ? "申购" : "买入";
  const sellVerb = holding.assetType === "fund" ? "赎回" : "卖出";
  const shortLabel = isReduce ? `${sellVerb} ${amount}` : isAdd ? `${buyVerb} ${amount}` : action.action;
  const mediumLabel = isReduce ? "降回上限" : isAdd ? "分批到目标" : action.action === "设置计划" ? "补目标带" : "维持区间";
  const longLabel =
    action.action === "设置计划" ? "建立目标带" : isReduce ? "回到目标带" : isAdd ? "接近目标带" : band.target > 0 ? "守住目标带" : "复核配置";

  return {
    action: action.action,
    amount,
    delta,
    reason: compactTableText(action.reason),
    short: { label: shortLabel, detail: "0-2 周", tone: action.tone },
    medium: { label: mediumLabel, detail: `2-12 周 · ${targetLabel}`, tone: isReduce ? "caution" : action.tone },
    long: { label: longLabel, detail: `3-12 个月 · ${targetLabel}`, tone: action.action === "设置计划" ? "caution" : "neutral" },
    tone: action.tone,
  };
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

function allocationChartData(rows: HoldingView[]) {
  const order: HoldingAssetType[] = ["cash", "fund", "etf", "stock", "other"];
  const total = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const buckets = rows.reduce<Map<HoldingAssetType, { color: string; name: string; value: number }>>((acc, row) => {
    const assetType = isCashHolding(row) ? "cash" : row.assetType ?? "stock";
    const bucket = acc.get(assetType) ?? { color: assetTypeChartColor(assetType), name: holdingAssetTypeLabel(assetType), value: 0 };
    bucket.value += row.marketValue;
    acc.set(assetType, bucket);
    return acc;
  }, new Map());

  return Array.from(buckets.entries())
    .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    .map(([, bucket]) => ({
      itemStyle: { color: bucket.color },
      name: bucket.name,
      percent: total > 0 ? roundChartValue((bucket.value / total) * 100) : 0,
      value: roundChartValue(bucket.value),
    }));
}

function assetTypeChartColor(assetType: HoldingAssetType) {
  switch (assetType) {
    case "cash":
      return "#0fa574";
    case "fund":
      return "#c4ad5d";
    case "etf":
      return "#5a91c8";
    case "stock":
      return "#d76561";
    case "other":
      return "#8792a4";
  }
}

function chartToneColor(tone: "positive" | "neutral" | "caution" | "negative") {
  switch (tone) {
    case "positive":
      return "#11a979";
    case "caution":
      return "#c4ad5d";
    case "negative":
      return "#d76561";
    case "neutral":
      return "#7d8b9d";
  }
}

function chartRangeColor(tone: "positive" | "neutral" | "caution" | "negative") {
  switch (tone) {
    case "positive":
      return "rgba(17, 169, 121, 0.28)";
    case "caution":
      return "rgba(196, 173, 93, 0.30)";
    case "negative":
      return "rgba(215, 101, 97, 0.30)";
    case "neutral":
      return "rgba(125, 139, 157, 0.24)";
  }
}

function roundChartValue(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function roundChartAxisMax(value: number) {
  return Math.max(10, Math.ceil(value / 5) * 5);
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
