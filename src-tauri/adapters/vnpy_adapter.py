import importlib
import json
import os
import sys
import time
from pathlib import Path


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def fail(status, message, action, warnings=None):
    emit({
        "accepted": False,
        "submitted": False,
        "status": status,
        "message": message,
        "eventLabel": "命令失败",
        "warnings": warnings or [message],
        "commandPreview": [],
        "action": action,
    })


def read_payload():
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def load_json_env(json_key, path_key):
    raw_path = os.environ.get(path_key, "").strip()
    if raw_path:
        return json.loads(Path(raw_path).expanduser().read_text(encoding="utf-8"))
    raw_json = os.environ.get(json_key, "").strip()
    if raw_json:
        candidate = Path(raw_json).expanduser()
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
        return json.loads(raw_json)
    return {}


def parse_float(value, default=0.0):
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return default


def parse_symbol(symbol, default_exchange):
    if "." in symbol:
        raw_symbol, raw_exchange = symbol.rsplit(".", 1)
        return raw_symbol, raw_exchange
    return symbol, default_exchange


def enum_value(enum_cls, value, fallback):
    if value:
        try:
            return enum_cls[value]
        except Exception:
            try:
                return enum_cls(value)
            except Exception:
                pass
    return fallback


def status_key(order):
    if not order:
        return "synced"
    status = getattr(order, "status", None)
    name = getattr(status, "name", "")
    if name == "PARTTRADED":
        return "partially_filled"
    if name == "ALLTRADED":
        return "filled"
    if name == "CANCELLED":
        return "cancelled"
    if name == "REJECTED":
        return "error"
    return "submitted"


def safe_call(obj, name):
    fn = getattr(obj, name, None)
    if not callable(fn):
        return []
    try:
        return list(fn() or [])
    except Exception:
        return []


def enum_text(value):
    return getattr(value, "value", str(value or ""))


def order_to_dict(order):
    if not order:
        return None
    status = getattr(order, "status", None)
    direction = getattr(order, "direction", None)
    exchange = getattr(order, "exchange", None)
    return {
        "vtOrderId": getattr(order, "vt_orderid", ""),
        "orderId": getattr(order, "orderid", ""),
        "symbol": getattr(order, "symbol", ""),
        "exchange": getattr(exchange, "value", str(exchange or "")),
        "direction": getattr(direction, "name", str(direction or "")),
        "price": getattr(order, "price", 0),
        "volume": getattr(order, "volume", 0),
        "traded": getattr(order, "traded", 0),
        "status": getattr(status, "name", str(status or "")),
        "statusText": getattr(status, "value", str(status or "")),
        "gatewayName": getattr(order, "gateway_name", ""),
    }


def account_to_dict(account):
    if not account:
        return None
    return {
        "accountId": getattr(account, "accountid", ""),
        "vtAccountId": getattr(account, "vt_accountid", ""),
        "balance": getattr(account, "balance", 0),
        "available": getattr(account, "available", 0),
        "frozen": getattr(account, "frozen", 0),
        "gatewayName": getattr(account, "gateway_name", ""),
    }


def position_to_dict(position):
    if not position:
        return None
    direction = getattr(position, "direction", None)
    exchange = getattr(position, "exchange", None)
    volume = parse_float(getattr(position, "volume", 0), 0.0)
    price = parse_float(getattr(position, "price", 0), 0.0)
    return {
        "vtPositionId": getattr(position, "vt_positionid", ""),
        "symbol": getattr(position, "symbol", ""),
        "exchange": enum_text(exchange),
        "direction": getattr(direction, "name", enum_text(direction)),
        "quantity": volume,
        "available": volume - parse_float(getattr(position, "frozen", 0), 0.0),
        "price": price,
        "marketValue": volume * price,
        "cost": getattr(position, "yd_volume", 0),
        "unrealizedPnl": getattr(position, "pnl", 0),
        "gatewayName": getattr(position, "gateway_name", ""),
    }


def trade_to_dict(trade):
    if not trade:
        return None
    direction = getattr(trade, "direction", None)
    exchange = getattr(trade, "exchange", None)
    return {
        "vtTradeId": getattr(trade, "vt_tradeid", ""),
        "tradeId": getattr(trade, "tradeid", ""),
        "orderId": getattr(trade, "orderid", ""),
        "symbol": getattr(trade, "symbol", ""),
        "exchange": enum_text(exchange),
        "direction": getattr(direction, "name", enum_text(direction)),
        "price": getattr(trade, "price", 0),
        "volume": getattr(trade, "volume", 0),
        "datetime": str(getattr(trade, "datetime", "") or ""),
        "gatewayName": getattr(trade, "gateway_name", ""),
    }


def tick_to_quote_dict(tick, request, route):
    if not tick:
        return None
    return {
        "accepted": True,
        "bridge": "vnpy",
        "route": route or "vn.py Gateway",
        "status": "synced",
        "symbol": getattr(tick, "symbol", "") or request.get("symbol", ""),
        "name": request.get("name", ""),
        "market": request.get("market", ""),
        "assetType": request.get("assetType", ""),
        "bid": parse_float(getattr(tick, "bid_price_1", 0), 0.0) or None,
        "ask": parse_float(getattr(tick, "ask_price_1", 0), 0.0) or None,
        "last": parse_float(getattr(tick, "last_price", 0), 0.0) or None,
        "nav": None,
        "indicativeNav": None,
        "premiumDiscountPct": None,
        "session": "unknown",
        "source": "vn.py get_tick",
        "tradableVolume": parse_float(getattr(tick, "volume", 0), 0.0) or None,
        "currency": request.get("currency", ""),
        "warnings": [],
        "commandPreview": ["MainEngine.get_tick()"],
        "syncedAt": "",
        "message": "vn.py market quote synced",
    }


def find_order(main_engine, order_ref):
    if not order_ref:
        return None
    for order in main_engine.get_all_orders():
        if order_ref in {getattr(order, "vt_orderid", ""), getattr(order, "orderid", "")}:
            return order
    return None


def build_engine(payload):
    workspace = payload.get("workspacePath") or ""
    if workspace:
        sys.path.insert(0, workspace)

    gateway_module = os.environ.get("RPORTFOLIO_VNPY_GATEWAY_MODULE", "").strip()
    gateway_class = os.environ.get("RPORTFOLIO_VNPY_GATEWAY_CLASS", "").strip()
    if not gateway_module or not gateway_class:
        raise RuntimeError(
            "vn.py gateway is not configured. Set RPORTFOLIO_VNPY_GATEWAY_MODULE and RPORTFOLIO_VNPY_GATEWAY_CLASS."
        )

    from vnpy.event import EventEngine
    from vnpy.trader.engine import MainEngine

    module = importlib.import_module(gateway_module)
    cls = getattr(module, gateway_class)
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)
    gateway_name = os.environ.get("RPORTFOLIO_VNPY_GATEWAY_NAME", "").strip()
    gateway = main_engine.add_gateway(cls, gateway_name)
    gateway_name = gateway.gateway_name

    connect_setting = load_json_env("RPORTFOLIO_VNPY_CONNECT_JSON", "RPORTFOLIO_VNPY_CONNECT_PATH")
    if connect_setting:
        main_engine.connect(connect_setting, gateway_name)
        time.sleep(parse_float(os.environ.get("RPORTFOLIO_VNPY_CONNECT_WAIT_SECS", "1.5"), 1.5))

    return main_engine, gateway_name


def build_order_request(request):
    from vnpy.trader.constant import Direction, Exchange, Offset, OrderType
    from vnpy.trader.object import OrderRequest

    default_exchange = os.environ.get("RPORTFOLIO_VNPY_EXCHANGE", "SMART").strip() or "SMART"
    symbol, exchange_key = parse_symbol(request.get("symbol", ""), default_exchange)
    price = parse_float(request.get("limit"), 0.0)
    quantity = parse_float(request.get("quantity"), 0.0)
    if quantity <= 0 and price > 0:
        quantity = parse_float(request.get("amount"), 0.0) / price

    direction = Direction.LONG if str(request.get("side", "")).upper() == "BUY" else Direction.SHORT
    order_type = enum_value(OrderType, os.environ.get("RPORTFOLIO_VNPY_ORDER_TYPE", "LIMIT"), OrderType.LIMIT)
    offset = enum_value(Offset, os.environ.get("RPORTFOLIO_VNPY_OFFSET", "NONE"), Offset.NONE)

    return OrderRequest(
        symbol=symbol,
        exchange=enum_value(Exchange, exchange_key, Exchange.SMART),
        direction=direction,
        type=order_type,
        volume=quantity,
        price=price,
        offset=offset,
        reference=request.get("orderId") or "rPortfolio",
    )


def build_cancel_request(request):
    from vnpy.trader.constant import Exchange
    from vnpy.trader.object import CancelRequest

    default_exchange = os.environ.get("RPORTFOLIO_VNPY_EXCHANGE", "SMART").strip() or "SMART"
    symbol, exchange_key = parse_symbol(request.get("symbol", ""), default_exchange)
    order_ref = request.get("orderRef") or ""
    order_id = order_ref.split(".", 1)[1] if "." in order_ref else order_ref
    if not order_id:
        raise RuntimeError("orderRef is required for cancelOrder.")

    return CancelRequest(
        orderid=order_id,
        symbol=symbol,
        exchange=enum_value(Exchange, exchange_key, Exchange.SMART),
    )


def submit_order(payload, request, action):
    main_engine, gateway_name = build_engine(payload)
    try:
        req = build_order_request(request)
        vt_orderid = main_engine.send_order(req, gateway_name)
        wait_secs = parse_float(os.environ.get("RPORTFOLIO_VNPY_ORDER_WAIT_SECS", "0.5"), 0.5)
        if wait_secs > 0:
            time.sleep(wait_secs)
        order = find_order(main_engine, vt_orderid)
        if not vt_orderid:
            raise RuntimeError("vn.py gateway returned an empty vt_orderid.")
        emit({
            "accepted": True,
            "submitted": True,
            "status": status_key(order),
            "orderRef": vt_orderid,
            "message": f"vn.py order submitted: {vt_orderid}",
            "eventLabel": "已提交",
            "warnings": [],
            "commandPreview": [f"MainEngine.send_order({req}, {gateway_name})"],
            "rawOrder": order_to_dict(order),
            "action": action,
        })
    finally:
        main_engine.close()


def cancel_order(payload, request, action):
    main_engine, gateway_name = build_engine(payload)
    try:
        req = build_cancel_request(request)
        main_engine.cancel_order(req, gateway_name)
        emit({
            "accepted": True,
            "submitted": False,
            "status": "ready_to_cancel",
            "orderRef": request.get("orderRef") or req.orderid,
            "message": f"vn.py cancel sent: {req.orderid}",
            "eventLabel": "撤单已发送",
            "warnings": [],
            "commandPreview": [f"MainEngine.cancel_order({req}, {gateway_name})"],
            "action": action,
        })
    finally:
        main_engine.close()


def sync_order_status(payload, request, action):
    main_engine, _gateway_name = build_engine(payload)
    try:
        wait_secs = parse_float(os.environ.get("RPORTFOLIO_VNPY_SYNC_WAIT_SECS", "0.8"), 0.8)
        if wait_secs > 0:
            time.sleep(wait_secs)
        order = find_order(main_engine, request.get("orderRef") or "")
        orders = [order_to_dict(item) for item in main_engine.get_all_orders()]
        emit({
            "accepted": True,
            "submitted": False,
            "status": status_key(order) if order else request.get("currentStatus") or "synced",
            "orderRef": request.get("orderRef") or "",
            "message": f"vn.py sync complete: {len(orders)} orders",
            "eventLabel": "状态同步",
            "warnings": [] if order else ["No matching order returned by vn.py; keeping current order status."],
            "commandPreview": ["MainEngine.get_all_orders()"],
            "rawOrder": order_to_dict(order),
            "rawOrders": orders,
            "action": action,
        })
    finally:
        main_engine.close()


def sync_account(payload, request, action):
    main_engine, _gateway_name = build_engine(payload)
    try:
        wait_secs = parse_float(os.environ.get("RPORTFOLIO_VNPY_SYNC_WAIT_SECS", "0.8"), 0.8)
        if wait_secs > 0:
            time.sleep(wait_secs)
        accounts = [account_to_dict(item) for item in safe_call(main_engine, "get_all_accounts")]
        positions = [position_to_dict(item) for item in safe_call(main_engine, "get_all_positions")]
        orders = [order_to_dict(item) for item in safe_call(main_engine, "get_all_orders")]
        trades = [trade_to_dict(item) for item in safe_call(main_engine, "get_all_trades")]
        primary = next((item for item in accounts if item), {}) or {}
        cash = parse_float(primary.get("available"), 0.0)
        equity = parse_float(primary.get("balance"), 0.0)
        market_value = sum(parse_float(item.get("marketValue"), 0.0) for item in positions if item)
        emit({
            "accepted": True,
            "bridge": "vnpy",
            "route": payload.get("route") or "vn.py Gateway",
            "status": "synced",
            "accountId": primary.get("vtAccountId") or primary.get("accountId") or "",
            "accountName": primary.get("gatewayName") or "vn.py",
            "currency": request.get("currency") or "",
            "cash": cash,
            "marketValue": market_value,
            "equity": equity or cash + market_value,
            "positions": [item for item in positions if item],
            "orders": [item for item in orders if item],
            "trades": [item for item in trades if item],
            "message": f"vn.py account sync complete: {len(positions)} positions, {len(orders)} orders, {len(trades)} trades",
            "warnings": [] if accounts else ["No account returned by vn.py; positions/orders may still be available."],
            "commandPreview": [
                "MainEngine.get_all_accounts()",
                "MainEngine.get_all_positions()",
                "MainEngine.get_all_orders()",
                "MainEngine.get_all_trades()",
            ],
            "syncedAt": payload.get("generatedAt") or "",
        })
    finally:
        main_engine.close()


def sync_market_quote(payload, request, action):
    main_engine, _gateway_name = build_engine(payload)
    try:
        wait_secs = parse_float(os.environ.get("RPORTFOLIO_VNPY_QUOTE_WAIT_SECS", "0.2"), 0.2)
        if wait_secs > 0:
            time.sleep(wait_secs)
        symbol = request.get("symbol") or ""
        market = request.get("market") or os.environ.get("RPORTFOLIO_VNPY_EXCHANGE", "SMART")
        raw_symbol, exchange = parse_symbol(symbol, market)
        candidates = []
        if "." in symbol:
            candidates.append(symbol)
        candidates.append(f"{raw_symbol}.{exchange}")
        candidates.append(raw_symbol)
        tick = None
        get_tick = getattr(main_engine, "get_tick", None)
        if callable(get_tick):
            for candidate in candidates:
                try:
                    tick = get_tick(candidate)
                except Exception:
                    tick = None
                if tick:
                    break
        quote = tick_to_quote_dict(tick, request, payload.get("route"))
        if quote:
            quote["syncedAt"] = payload.get("generatedAt") or ""
            emit(quote)
            return
        reference = parse_float(request.get("referencePrice"), 0.0)
        emit({
            "accepted": False,
            "bridge": "vnpy",
            "route": payload.get("route") or "vn.py Gateway",
            "status": "quote_missing",
            "symbol": symbol,
            "name": request.get("name", ""),
            "market": request.get("market", ""),
            "assetType": request.get("assetType", ""),
            "bid": None,
            "ask": None,
            "last": reference or None,
            "session": "unknown",
            "source": "vn.py get_tick",
            "tradableVolume": None,
            "warnings": ["vn.py did not return a tick. Subscribe market data or confirm vt_symbol mapping."],
            "commandPreview": [f"MainEngine.get_tick({candidate})" for candidate in candidates],
            "syncedAt": payload.get("generatedAt") or "",
            "message": f"vn.py quote missing for {symbol}",
        })
    finally:
        main_engine.close()


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()
    request = payload.get("request", {})
    try:
        if action == "submitOrder":
            submit_order(payload, request, action)
        elif action == "cancelOrder":
            cancel_order(payload, request, action)
        elif action == "syncOrderStatus":
            sync_order_status(payload, request, action)
        elif action == "syncAccount":
            sync_account(payload, request, action)
        elif action == "syncMarketQuote":
            sync_market_quote(payload, request, action)
        else:
            fail("unsupported_action", f"Unsupported vn.py action: {action}", action)
    except Exception as exc:
        fail("adapter_error", str(exc), action)


if __name__ == "__main__":
    main()
