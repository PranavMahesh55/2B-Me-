from __future__ import annotations

import httpx

from backend.app.config.settings import settings


def _launch_secret() -> str | None:
    """Written 0600 by the signer at startup; a web page cannot read it."""
    try:
        return settings.launch_secret_path.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


async def broker_execute(
    *, token: dict, plan: dict, tamper: str | None = None
) -> tuple[dict | None, str | None, int]:
    """Hand a signed grant to the broker. Returns (receipt, error_code, status).

    Never raises: every failure has to come back as an enumerated code, because
    techspecsigner.md §10 forbids answering with a 500.
    """
    body: dict = {"token": token, "plan": plan}
    if tamper:
        body["__tamper"] = tamper

    headers = {"Content-Type": "application/json", "Origin": settings.broker_origin}
    secret = _launch_secret()
    if secret:
        headers["X-2bme-Launch-Secret"] = secret

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.broker_url}/execute", json=body, headers=headers
            )
    except httpx.HTTPError:
        # Outside GrantErrorCode, and a 503 rather than a 403, so the UI can tell
        # "the broker denied this" from "the broker is not running".
        return None, "broker_unavailable", 503

    try:
        payload = response.json()
    except ValueError:
        return None, "broker_unavailable", 503

    if response.status_code == 200:
        return payload, None, 200
    return None, payload.get("error", "broker_unavailable"), response.status_code
