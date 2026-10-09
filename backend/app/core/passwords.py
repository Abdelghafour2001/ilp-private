"""Password hashing, with no new dependency.

`scrypt` is in the standard library and is memory-hard, which is the property
that matters here: a stolen hash should cost an attacker real hardware, not a
GPU afternoon. The parameters below are the interactive-login settings from the
scrypt paper, ~64 MB and ~100 ms per verification on a normal machine.

The stored string carries its own parameters:

    scrypt$16384$8$1$<salt b64>$<hash b64>

so raising the cost later does not invalidate existing hashes — an old hash
still verifies with the parameters it was written with, and is rewritten on the
next successful sign-in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os

N = 2**14  # CPU/memory cost
R = 8      # block size
P = 1      # parallelism
SALT_BYTES = 16
KEY_BYTES = 32

# scrypt needs maxmem raised: the default 32 MB is below what these parameters
# ask for (128 * N * r ≈ 16 MB, plus headroom the implementation wants).
MAXMEM = 128 * N * R * 2


def hash_password(password: str) -> str:
    salt = os.urandom(SALT_BYTES)
    key = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P,
                         maxmem=MAXMEM, dklen=KEY_BYTES)
    return "$".join([
        "scrypt", str(N), str(R), str(P),
        base64.b64encode(salt).decode(), base64.b64encode(key).decode(),
    ])


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check. False for anything malformed rather than raising —
    a corrupt hash must read as "wrong password", never as a 500 that tells an
    attacker the account exists."""
    try:
        scheme, n, r, p, salt_b64, key_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(key_b64)
        candidate = hashlib.scrypt(
            password.encode(), salt=salt, n=int(n), r=int(r), p=int(p),
            maxmem=128 * int(n) * int(r) * 2, dklen=len(expected),
        )
    except (ValueError, TypeError, MemoryError):
        return False
    return hmac.compare_digest(candidate, expected)


def complaint(password: str) -> str:
    """Why this password is not acceptable, or "" when it is.

    Deliberately short: length is what actually resists guessing, and a rule
    demanding a symbol and a digit mostly produces Password1! on every account.
    """
    if len(password) < 12:
        return "A password needs at least 12 characters."
    if password.lower() in {"password1234", "motdepasse12", "123456789012"}:
        return "That password is among the first an attacker tries."
    return ""
