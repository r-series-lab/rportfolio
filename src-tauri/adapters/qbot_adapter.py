import json
import os
import shlex
import subprocess
import sys


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


def run_configured_command(command, action, payload):
    env = os.environ.copy()
    workspace = payload.get("workspacePath") or ""
    if workspace:
        env["PYTHONPATH"] = workspace + os.pathsep + env.get("PYTHONPATH", "")

    completed = subprocess.run(
        shlex.split(command) + [action],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        env=env,
        timeout=float(os.environ.get("RPORTFOLIO_QBOT_TIMEOUT_SECS", "15")),
        check=False,
    )
    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    if completed.returncode != 0:
        raise RuntimeError(stderr or f"Qbot command exited with {completed.returncode}")
    if not stdout:
        return {
            "accepted": True,
            "submitted": action == "submitOrder",
            "status": "submitted" if action == "submitOrder" else "synced",
            "message": "Qbot command completed.",
            "warnings": [stderr] if stderr else [],
            "commandPreview": [command],
        }
    try:
        response = json.loads(stdout)
    except Exception:
        response = {
            "accepted": True,
            "submitted": action == "submitOrder",
            "status": "submitted" if action == "submitOrder" else "synced",
            "message": stdout,
            "warnings": [stderr] if stderr else [],
            "commandPreview": [command],
        }
    return response


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()
    command = os.environ.get("RPORTFOLIO_QBOT_COMMAND", "").strip()
    if not command:
        fail(
            "adapter_not_configured",
            "Qbot adapter command is not configured. Set RPORTFOLIO_QBOT_COMMAND to a JSON stdin compatible command.",
            action,
        )
        return

    try:
        response = run_configured_command(command, action, payload)
        response.setdefault("accepted", True)
        response.setdefault("submitted", action == "submitOrder")
        response.setdefault("status", "submitted" if action == "submitOrder" else "synced")
        response.setdefault("message", "Qbot command completed.")
        response.setdefault("eventLabel", "已提交" if action == "submitOrder" else "状态同步")
        response.setdefault("warnings", [])
        response.setdefault("commandPreview", [command])
        response.setdefault("action", action)
        emit(response)
    except Exception as exc:
        fail("adapter_error", str(exc), action)


if __name__ == "__main__":
    main()
