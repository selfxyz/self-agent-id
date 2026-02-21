from functools import wraps
from flask import request, g, jsonify


def require_agent(verifier):
    """Flask decorator that verifies Self Agent ID on incoming requests.

    On success: sets g.agent = VerificationResult, calls the route handler.
    On failure: returns 401 JSON response.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            sig = request.headers.get("x-self-agent-signature")
            ts = request.headers.get("x-self-agent-timestamp")
            if not sig or not ts:
                return jsonify({"error": "Missing agent authentication headers"}), 401

            body = request.get_data(as_text=True) or None
            result = verifier.verify(
                signature=sig, timestamp=ts,
                method=request.method,
                url=request.full_path.rstrip("?"),
                body=body,
            )
            if not result.valid:
                return jsonify({"error": result.error}), 401

            g.agent = result
            return f(*args, **kwargs)
        return wrapper
    return decorator
