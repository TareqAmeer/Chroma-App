#!/usr/bin/env python3
"""Small, deterministic Chromasmith launcher used by diagnostics and repro scripts."""
import argparse
import json
import os
import secrets
import signal
import subprocess
import sys
import time

import find_process


def app_path():
    return find_process.REAL_APP_PATH

def base_path():
    return os.path.join(tempfile.gettempdir(), "chromasmith_automation")

def automation_path(kind):
    return os.path.join(tempfile.gettempdir(), f"chromasmith_automation_{kind}.json")

def write_json(path, value):
    fd, tmp = tempfile.mkstemp(prefix="chromasmith-automation-", dir=os.path.dirname(path))
    with os.fdopen(fd, "w") as f: json.dump(value, f)
    os.replace(tmp, path)


def find_pid():
    try:
        return find_process.find_chromasmith_pid()[0]
    except find_process.ProcessNotFound:
        return None


def start(automation=False, env=()):
    pid = find_pid()
    if pid:
        print(f"already running pid={pid}")
        return 0
    if automation:
        write_json(automation_path("enable"), {"token": secrets.token_urlsafe(24)})
    subprocess.Popen(["open", "-n", *[a for kv in env for a in ("--env", kv)], app_path()], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        time.sleep(0.2)
        pid = find_pid()
        if pid:
            print(f"started pid={pid} app={app_path()}")
            return 0
    print("start timed out", file=sys.stderr)
    return 1


def stop():
    pid = find_pid()
    if not pid:
        print("not running")
        return 0
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        time.sleep(0.2)
        if not find_pid():
            print(f"stopped pid={pid}")
            return 0
    print(f"stop timed out pid={pid}; refusing to force-kill", file=sys.stderr)
    return 1

def run_automation(args):
    enable = automation_path("enable")
    if not os.path.exists(enable): raise SystemExit("automation is not enabled; start with --automation")
    with open(enable) as f: token = json.load(f)["token"]
    cmd = {"id": secrets.token_hex(8), "token": token, "action": args.action}
    if args.action == "eval": cmd["code"] = args.code or "null"
    if args.action in ("click", "setValue"): cmd["selector"] = args.selector
    if args.action == "setValue": cmd["value"] = args.value or ""
    if args.action == "key": cmd["key"] = args.key
    write_json(automation_path("command"), cmd)
    result = automation_path("result")
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        try:
            with open(result) as f: out = json.load(f)
            if out.get("id") == cmd["id"]:
                print(json.dumps(out, separators=(",", ":")))
                return 0 if out.get("ok") else 1
        except (FileNotFoundError, json.JSONDecodeError): pass
        time.sleep(0.1)
    print("automation timed out", file=sys.stderr); return 1


def status():
    pid = find_pid()
    print(f"running pid={pid}" if pid else "not running")
    return 0


import tempfile
parser = argparse.ArgumentParser()
parser.add_argument("command", choices=["start", "stop", "status", "run", "screenshot"])
parser.add_argument("--env", action="append", default=[], help="KEY=VAL passed to the launched app (repeatable), e.g. CS_DIAG_RAW_STAGES=1")
parser.add_argument("--out", default="/tmp/chromasmith_window.png", help="screenshot output path")
parser.add_argument("--automation", action="store_true")
parser.add_argument("--action", default="eval")
parser.add_argument("--code")
parser.add_argument("--selector")
parser.add_argument("--value")
parser.add_argument("--key")
parser.add_argument("--timeout", type=float, default=10)
args = parser.parse_args()
def screenshot():
    import screenshot as _shot
    ok = _shot.capture_window(args.out)
    print(args.out if ok else "screenshot failed")
    return 0 if ok else 1
sys.exit(start(args.automation, args.env) if args.command == "start" else run_automation(args) if args.command == "run" else {"stop": stop, "status": status, "screenshot": screenshot}[args.command]())
