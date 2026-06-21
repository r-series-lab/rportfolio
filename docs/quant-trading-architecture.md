# 量化交易架构落地

rPortfolio 的交易能力按四层拆分，避免把策略、页面和券商通道绑在一起。

## 当前定位

- `Profile`：定义市场、标的池、规则、校准、基金画像和 mandate，是状态判断与风控语义来源。
- `PositionPlan`：把持仓、现金、目标带、风险门转成可执行动作，是建议单来源。
- `StrategyEngine`：把 `Profile + PositionPlan + TradeHabit` 转成策略评分、信号摘要和 `OrderIntent[]`。
- `BrokerAdapter`：把 `OrderRecord` 统一路由到本地模拟、Qbot 或 vn.py，并描述当前通道能力。

## 已落地

第一步已经新增 `src/lib/strategy-engine.ts`：

- 策略注册表：`STRATEGY_REGISTRY`
- 策略定义：`STRATEGIES`
- Qbot 预设：`QBOT_PRESETS`
- 统一输入：`StrategyEngineInput`
- 统一输出：`StrategyEvaluation`
- 订单意图：`OrderIntent`

量化交易页现在只消费 `evaluateStrategy(...)`，不再直接实现策略评分和建议单生成。

第二步已经新增 `src/lib/order-store.ts`：

- 订单状态模型：`OrderRecord`
- 生命周期状态：`preview / queued / blocked / prepared / submitted / partially_filled / filled / cancelled / error`
- 订单来源：`strategy / manual / profile-monitor / broker-sync`
- 订单事件：`OrderEvent`
- 订单中心摘要：`OrderCenterSummary`
- 订单创建：`createOrderRecordFromIntent`
- 路由回写：`applyOrderRouteResult`
- 队列合并与重复过滤：`mergeOrderRecords`
- 旧本地数据归一化：`normalizeOrderRecords`
- 路由错误标准化：`routeOrderErrorResult`

量化交易页现在使用统一的 `OrderRecord` 管理委托队列，并通过本地存储保留最近的模拟委托。策略建议、手动下单、Profile Monitor 自动触发都会进入同一个 Order Center；同一 Profile/策略/通道下的活跃建议单会去重，手动单保留多次下单能力。

第三步已经新增 `src/lib/broker-adapter.ts`：

- 通道模式：`local-paper / qbot-bridge / live-gateway`
- 通道计划：`BrokerAdapterPlan`
- 通道能力：`prepareOrder / submitOrder / cancelOrder / syncOrders / syncAccount`
- 通道路由：`routeOrderThroughAdapter`
- 模式映射：`brokerModeToBridge`

量化交易页现在只读取 adapter plan 和路由结果，不再直接理解 Qbot/vn.py 的路径、能力和订单 payload。

第四步已经新增 `src/lib/profile-monitor.ts`：

- Profile 状态快照：`ProfileMonitorSnapshot`
- Profile 变化评估：`evaluateProfileMonitor`
- 委托去重指纹：`orderIntentFingerprint / orderRecordFingerprint`
- 监测事件：`ProfileMonitorEvent`
- 自动排队候选：`autoQueueIntents`

监测逻辑采用“先建立基线，再响应变化”的方式：首次开启只记录当前 Profile，后续刷新时比较状态指纹；只有状态变化且出现未排队、未见过的新委托，才进入自动排队。

第五步已经新增 Tauri Order Commands：

- Rust command：`prepare_order / submit_order / cancel_order / sync_order_status`
- 前端桥接：`prepareOrder / submitOrder / cancelOrder / syncOrderStatus`
- Adapter 封装：`prepareOrderThroughAdapter / submitOrderThroughAdapter / cancelOrderThroughAdapter / syncOrderStatusThroughAdapter`
- 订单命令回写：`applyOrderCommandResult`

量化交易页现在可以对订单中心里的单执行提交、撤单和同步。本地模拟盘会直接推进状态；Qbot/vn.py 通道会走 Rust command，真实通道由 Broker Adapter Runner 执行并回写标准订单结果。

第六步已经新增 Broker Adapter Runner：

- `src-tauri/adapters/vnpy_adapter.py`
  通过 vn.py `MainEngine.send_order / cancel_order / get_all_orders` 执行真实委托、撤单和同步。
- `src-tauri/adapters/qbot_adapter.py`
  通过 `RPORTFOLIO_QBOT_COMMAND` 调用外部 Qbot JSON adapter；当前本机 Qbot 仓库没有完整 `qbot.engine.trade` 包，因此先走可配置命令协议。
- Rust `submit_order / cancel_order / sync_order_status`
  在 `RPORTFOLIO_BROKER_LIVE=1` 且前端动作允许实盘时，会调用对应 Python runner；runner stdout 必须是 JSON，Rust 会归一成 `OrderCommandResult`。

vn.py 真实 gateway 需要这些环境变量：

- `RPORTFOLIO_BROKER_LIVE=1`
- `RPORTFOLIO_VNPY_GATEWAY_MODULE`
- `RPORTFOLIO_VNPY_GATEWAY_CLASS`
- `RPORTFOLIO_VNPY_GATEWAY_NAME`，可选
- `RPORTFOLIO_VNPY_CONNECT_PATH` 或 `RPORTFOLIO_VNPY_CONNECT_JSON`
- `RPORTFOLIO_VNPY_EXCHANGE`，默认 `SMART`

Qbot 真实 adapter 需要：

- `RPORTFOLIO_BROKER_LIVE=1`
- `RPORTFOLIO_QBOT_COMMAND`

Qbot command 接收 stdin JSON 和 action 参数，例如：`python qbot_order_adapter.py submitOrder`，并向 stdout 输出 JSON：`accepted / submitted / status / orderRef / message / warnings / commandPreview / eventLabel`。

第七步已经新增 Persistent Order Store：

- Rust core：`load_orders_from_path / save_orders_to_path`
- Tauri command：`load_orders / save_orders`
- 前端持久化：`src/lib/order-persistence.ts`
- React hook：`src/hooks/use-order-store.ts`

订单中心现在优先保存到 Tauri App Data 的 `orders.json`，浏览器预览时回退到 localStorage。首次进入 Tauri 版时，如果 App Data 为空且 localStorage 里有旧委托，会自动迁移。当前采用 JSON 快照，保留每条订单内的事件时间线；后续当订单查询、审计导出和统计维度增多时，再把同一层升级为 SQLite。

第八步已经新增 Order Audit Export：

- Rust core：`export_order_audit_from_paths`
- Tauri command：`export_order_audit`
- 前端入口：`exportOrderAudit`
- 页面动作：委托队列支持 `JSON / CSV` 导出

JSON 导出保留完整订单对象和事件时间线；CSV 导出按“一个订单事件一行”展开，包含订单、策略来源、broker 路由、状态、错误和事件字段，方便表格筛选、复盘和排错。

第九步已经新增 Persistent Monitor Store：

- Rust core：`load_monitor_state_from_path / save_monitor_state_to_path`
- Tauri command：`load_monitor_state / save_monitor_state`
- 前端持久化：`src/lib/monitor-persistence.ts`
- React hook：`src/hooks/use-monitor-store.ts`

Profile Monitor 现在优先保存到 Tauri App Data 的 `monitor.json`，浏览器预览时回退到 localStorage。存储内容包括当前基线 `snapshot` 和最近监测记录 `records`：每次建立基线、状态稳定、状态变化、自动排队、重复过滤都会留下一条可追溯记录。这样可以解释“为什么触发交易”和“为什么没有触发交易”。

第十步已经新增 BacktestEngine：

- 独立模块：`src/lib/backtest-engine.ts`
- 统一输入：`BacktestEngineInput`
- 统一输出：`BacktestRunResult`
- 模拟订单：`BacktestSimulatedOrder`
- 回测事件：`BacktestEvent`

量化交易页现在通过 `runBacktestEngine(...)` 运行回测，不再在页面组件里维护临时试算逻辑。BacktestEngine 会复用 StrategyEngine 输出的 `OrderIntent[]`，按当前持仓计划、样本状态、标的技术数据、交易习惯和手续费/滑点生成模拟成交、风控阻断、成本扣减、组合估值事件，并返回净收益、最大回撤、胜率、夏普、换手、净敞口和权益曲线。

第十一步已经新增 RiskGuard V1：

- 独立模块：`src/lib/risk-guard.ts`
- 标的分类：`fund / etf / leveraged-etf / stock / cash / other`
- 统一输入：`RiskGuardInput`
- 统一输出：`RiskGuardResult`
- 风控检查：`RiskGuardCheck`

RiskGuard 现在插在 `OrderIntent -> OrderRecord` 之间，策略建议、单条排队、手动下单、Profile Monitor 自动触发都会先经过同一套规则。第一阶段优先基金/ETF 交易正确性，而不是复杂日内亏损模型：

- 基金：按下一净值/渠道确认执行，检查基金披露新鲜度，避免把基金当成盘中撮合资产。
- ETF：默认限价保护，使用已有技术行做流动性降级，预留 bid/ask spread、premium/discount、iNAV 接入口。
- 杠杆/反向 ETF：更低单笔预算，日内下跌触发更强刹车。
- 交易正确性：现金覆盖、现金底线、卖出持仓覆盖、目标带上限、重复活跃委托、Profile 配置完整性。

风控结果会写入订单 `warnings` 和事件时间线。硬约束，例如现金不足、无可卖持仓、重复活跃委托、现金标的误交易，不允许手动放行；目标带、现金底线、组合风险等策略性限制可以通过手动放行降级为警告。

第十二步已经新增 Account Sync V1：

- Rust command：`sync_account`
- 前端桥接：`syncAccount`
- Adapter 封装：`syncAccountThroughAdapter`
- 账户快照：`BrokerAccountSnapshot`
- 订单回填：`applyBrokerAccountSnapshotToOrders`

Account Sync 现在可以通过当前 broker adapter 同步账户、持仓、委托和成交回报。右侧执行栏提供“账户同步”入口；同步结果会展示权益、现金、持仓数量，并尝试按 `orderRef / orderId / vtOrderId` 匹配订单中心里的委托，把真实账户回报回填为已提交、部分成交、已成交、已撤单或异常。

vn.py runner 已支持 `syncAccount`，通过 `MainEngine.get_all_accounts / get_all_positions / get_all_orders / get_all_trades` 返回统一 JSON。Qbot runner 继续走 `RPORTFOLIO_QBOT_COMMAND` 透传协议，只要外部 Qbot adapter 支持 `syncAccount` action，就可以直接回填同样结构。

第十三步已经新增 Execution Quality Guard V1：

- 独立模块：`src/lib/execution-quality.ts`
- 执行输入：`ExecutionQualityInput`
- 执行输出：`ExecutionQualityAssessment`
- 预留行情：`ExecutionQuote`
- 执行检查：`ExecutionQualityCheck`

Execution Quality Guard 现在由 RiskGuard 统一调用，负责判断“这笔单当前适不适合执行”。第一阶段先用已有数据和预留结构保护基金/ETF 执行：

- 基金：只走下一净值/渠道确认，不套用 ETF 的盘中价差和 NAV 规则。
- ETF：检查交易时段、bid/ask 价差、NAV/iNAV 折溢价、量能比、限价保护。
- 杠杆/反向 ETF：沿用更强预算限制，并额外提示高风险 ETF 执行。
- 股票：先做交易时段和限价保护。

当前如果缺少实时 `bid / ask / nav / iNAV`，规则会降级为警告并要求限价保护；后续 broker 行情接入后，同一 `ExecutionQuote` 结构可以直接把 ETF 价差、折溢价和实时可成交性升级为硬阻断。

第十四步已经新增 RiskGuard V2：

- 独立策略：`src/lib/risk-policy.ts`
- 持久化 hook：`src/hooks/use-risk-policy.ts`
- 默认策略：`DEFAULT_RISK_GUARD_POLICY`
- 策略归一化：`normalizeRiskGuardPolicy`

RiskGuard 的阈值现在不再写死在规则里，而是由 `RiskGuardPolicy` 控制。当前可配置：

- 单日最大委托数量
- 同标的同方向冷却时间
- ETF / 基金 / 股票 / 杠杆 ETF 单笔上限
- ETF 日内下跌提醒阈值
- ETF 日内下跌阻断阈值
- 杠杆 ETF 日内阻断阈值
- 实盘提交二次确认

量化交易页的风控弹窗已经提供这些核心配置入口，并用 localStorage 保存。实盘通道如果开启“实盘二次确认”，提交真实委托前必须先开启手动放行，避免误点直接提交。

第十五步已经新增 Portfolio Reconcile V1：

- 独立模块：`src/lib/account-book.ts`
- 多账户合并：`mergeAccountSnapshot`
- 账户账本：`accountBookFromSnapshots`
- 本地持仓对账：`reconcileAccountBookWithHoldings`
- 账本摘要：`summarizeAccountBook`

量化交易页现在不再只保留最后一次账户同步结果，而是按 `bridge / route / accountId / currency` 合并多个账户快照，形成统一账户账本。右侧执行栏会展示已同步账户数量、聚合权益、现金、持仓数量，并把 broker 返回的真实持仓和本地真实持仓做符号级对账。

当前对账先做差异报告，不自动覆盖持仓管理数据：

- `matched`：本地持仓和 broker 回报一致。
- `drift`：本地数量或市值与真实账户有偏差。
- `missing`：本地有持仓，但账户未返回。
- `extra`：账户有持仓，但本地未记录。

这个边界适合多平台、多账户场景：持仓管理继续作为目标账本和策略输入，broker 回报作为真实账户事实源。后续可以在差异可信后增加“采纳账户回报”或“生成修正委托”，而不是在同步阶段直接改写本地持仓。

第十六步已经新增 Market Data Adapter V1：

- Rust command：`sync_market_quote`
- 前端桥接：`syncMarketQuote`
- Adapter 封装：`syncMarketQuoteThroughAdapter`
- 统一快照：`MarketQuoteSnapshot`
- RiskGuard 接入：`quote -> evaluateExecutionQuality`

行情现在作为独立 adapter 能力接入，不和 Qbot/vn.py 强绑定。量化交易页在建议单或手动单排队前会自动回填当前标的 quote，并把 `bid / ask / last / nav / iNAV / premiumDiscountPct / tradableVolume / session` 喂给 Execution Quality Guard。

当前能力边界：

- 本地模拟：使用当前持仓价或分析价生成保护性 bid/ask，保证本地排队流程能走完。
- vn.py：通过 `MainEngine.get_tick` 尝试读取 tick，返回 bid/ask/last/volume。
- Qbot：继续走 `RPORTFOLIO_QBOT_COMMAND` JSON adapter，只要外部命令支持 `syncMarketQuote` action，就能返回同一结构。
- UI：右侧执行栏增加轻量行情卡，只显示当前标的盘口状态，不把交易页变成行情分析台。

这一步使 ETF 执行质量从“缺少 bid/ask 只能警告”升级为“有真实盘口时可以检查价差、折溢价和限价保护”；如果 adapter 缺少 quote，则仍保留预备队列和警告，不阻断整个页面。

第十七步已经新增 Risk Policy Storage V1：

- Rust storage：`load_risk_policy / save_risk_policy`
- 前端持久化：`src/lib/risk-policy-storage.ts`
- Hook 迁移：`useRiskPolicy`
- 审计快照：订单审计 JSON 增加 `riskPolicy`

风控策略现在和订单、Profile Monitor 一样进入 Tauri App Data，而不是只保存在 localStorage。浏览器预览仍使用 localStorage；桌面端首次加载时，如果 App Data 还没有策略，会用旧 localStorage 作为迁移种子并写回 App Data。

当前保存内容包括：

- 单日最大委托数量
- 同标的同方向冷却时间
- ETF / 基金 / 股票 / 杠杆 ETF 单笔上限
- ETF / 杠杆 ETF / 组合亏损刹车阈值
- 实盘提交二次确认
- 更新时间和版本号

订单审计 JSON 现在会带上导出时的 `riskPolicy` 快照。后续回看真实委托时，可以同时看到订单输入、行情回报、账户回报和当时采用的风控阈值。

第十八步已经新增 Submit-time Quote Guard V1：

- 订单生命周期：新增 `pre_submit_check` 事件
- 订单快照：新增 `preSubmitQuote / preSubmitRiskSummary`
- 提交流程：`submitOrder` 前强制同步最新 quote，并再次运行 RiskGuard
- 真实通道：如果提交前 quote 未就绪，直接阻断，不调用真实 submit
- 审计留痕：订单记录会保存提交前 quote 快照，订单审计 JSON 自动包含该快照

这一步只做“最后一道闸门”，不扩成复杂行情终端。排队阶段可以用预备行情和策略风控；真实提交前必须重新确认 broker 行情。如果盘口异常、ETF 价差/NAV 规则阻断、或者真实通道没有返回 quote，订单会在订单中心变成“提交前阻断”，并保留事件和原因。

后续深水区可以继续扩展：

- 多档盘口和冲击成本
- quote 延迟和 broker 时钟校验
- 基金申赎费率、确认日、到账日
- 已提交订单的 quote 快照和成交回报差异分析

## 扩展策略的方式

新增策略时只需要做三件事：

1. 增加一个 `StrategyDefinition`。
2. 给注册表提供 `score / buildSignals / buildOrders`。
3. 在 UI 中选择该策略或让 Qbot preset 映射到该策略。

策略应该输出 `OrderIntent[]`，不要直接调用券商，也不要直接修改持仓。真实交易由后续 OMS 和 Broker Adapter 负责。

## 下一步顺序

1. `Portfolio Reconcile Apply`
   在对账差异可信后，提供“采纳账户回报 / 生成修正委托 / 忽略差异”的人工确认流。

2. `Risk Policy Import / Export`
   提供风控策略导入、导出和恢复默认值，用于多设备或多账户环境迁移。

3. `Fund Adapter V1`
   针对基金/ETF 优先补基金平台申赎意图、确认日、费率和状态回报。

## 设计原则

- Profile 只管“市场状态和约束”。
- StrategyEngine 只管“从建议生成订单意图”。
- BrokerAdapter 只管“连接账户和交易网关”。
- UI 只管“选择、确认、展示状态”。
- 任何真实交易都必须能回放：输入、策略版本、订单意图、路由结果、成交回报都要留痕。
