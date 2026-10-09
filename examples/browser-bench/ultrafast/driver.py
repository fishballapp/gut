"""Runs one jev-ultrafast task and prints its outcome as JSON; leaves the tab open for grading."""
import json
import os
import sys
import time

import jev_ultrafast.model as model
from jev_ultrafast import Agent

# Count every Jev request (DONE and stale decisions included), not only executed actions.
# Redirects Jev requests to TYPESAFE_URL when set by wrapping jev_ultrafast.model.post_json.
jev = {"requests": 0, "inputTokens": 0}
recorded_events = []
_post_json = model.post_json


def redirecting_and_counting_post_json(url, key, body):
    override_url = os.environ.get("TYPESAFE_URL")
    target_url = override_url if (override_url and "systemone" in url) else url
    result = _post_json(target_url, key, body)
    if "systemone" in url or (override_url and "systemone" in target_url):
        jev["requests"] += 1
        jev["inputTokens"] += (result.get("usage") or {}).get("input_tokens", 0)
        if isinstance(body, dict) and "state" in body and "questions" in body:
            req_data = {
                "state": body.get("state"),
                "questions": body.get("questions"),
            }
            recorded_events.append({
                "kind": "request",
                "request": req_data,
                "response": result,
            })
    return result


model.post_json = redirecting_and_counting_post_json

url, goal, max_ticks = sys.argv[1], sys.argv[2], int(sys.argv[3])
started = time.perf_counter()
state = None
error = None
ticks = 0
try:
    agent = Agent(url, goal)
    for state in agent.run():
        ticks += 1
        history = (state or {}).get("history", [])
        last_action = history[-1].get("action") if history else None
        recorded_events.append({
            "kind": "log",
            "line": f"tick {ticks} {last_action or ''}".strip(),
        })
        if ticks >= max_ticks:
            break
except Exception as exc:  # report, don't crash: the runner grades whatever page is left
    error = f"{type(exc).__name__}: {exc}"

history = (state or {}).get("history", [])
print("===UF_RESULT===")
print(json.dumps({
    "status": (state or {}).get("status", "error"),
    "error": error,
    "ticks": ticks,
    "actions": [h.get("action") for h in history],
    "requests": jev["requests"],
    "inputTokens": jev["inputTokens"],
    "url": ((state or {}).get("page") or {}).get("url"),
    "ms": round((time.perf_counter() - started) * 1000),
    "events": recorded_events,
}))
