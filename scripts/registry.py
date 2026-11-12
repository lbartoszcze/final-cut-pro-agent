"""The npm registry probe baseline.py reads a released surface through: the
newest published release of a package, its tarball's registry path, and the
surface the tarball holds. A probe that cannot answer raises Unproven, never
an absence."""

from __future__ import annotations

import io
import json
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from surface import surface

NPM_REGISTRY = "https://registry.npmjs.org"
GITHUB_API = "https://api.github.com"

# A package the registry certainly serves, in the same request shape as the
# subject (unscoped). It exists to prove this probe can still recognise a
# published package at all.
CONTROL_PACKAGE = "three"

USER_AGENT = "final-cut-pro-agent-baseline (autoversion adoption)"
TIMEOUT = len("xxxxxxxxxxxxxxxxxxxx")  # seconds


class Unproven(RuntimeError):
    """A probe did not produce testimony we may act on. Never treat as absence."""


def _get(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except Exception as exc:  # transport: DNS, TLS, no egress, timeout
        raise Unproven(f"no answer from {url}: {exc!r}") from exc


# --------------------------------------------------------------------------
# npm
# --------------------------------------------------------------------------

def _npm_lookup(name: str) -> tuple[str, dict | None]:
    """Three states: ('named', doc) | ('absent', None) | raise Unproven."""
    if not name:
        raise Unproven(
            "the package name is empty, and npm answers generically, so a lookup "
            "would read as proven absence. Read the name from package.json."
        )
    url = f"{NPM_REGISTRY}/{urllib.parse.quote(name, safe='@')}"
    status, body = _get(url)
    try:
        document = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        raise Unproven(f"{name}: npm answered http {status} with a non-JSON body") from None
    if isinstance(document, dict) and document.get("name") == name:
        return "named", document
    error = str(document.get("error", "")) if isinstance(document, dict) else ""
    if "not found" in error.lower():
        return "absent", None
    raise Unproven(
        f"{name}: npm answered http {status} but neither named the package nor "
        f"stated it is absent (error={error!r}); its absence is unproven"
    )


def npm_latest(name: str) -> tuple[str, str] | None:
    """(version, tarball_filename) for the newest published release, or None."""
    state, _ = _npm_lookup(CONTROL_PACKAGE)
    if state != "named":
        raise Unproven(
            f"this step cannot recognise {CONTROL_PACKAGE!r}, which npm definitely "
            f"serves, so its verdict about {name!r} is meaningless. The check is "
            "broken, not the registry."
        )

    state, document = _npm_lookup(name)
    if state == "absent":
        return None

    latest = (document.get("dist-tags") or {}).get("latest")
    if not latest:
        raise Unproven(f"{name}: npm names the package but publishes no dist-tags.latest")
    release = (document.get("versions") or {}).get(latest) or {}
    tarball = ((release.get("dist") or {}).get("tarball") or "")
    if not tarball:
        raise Unproven(f"{name}@{latest}: npm names the release but serves no dist.tarball")
    return latest, tarball


def registry_path(tarball_url: str) -> str:
    """The path by which the registry addresses a tarball, less its leading slash.

    ``https://registry.npmjs.org/@types/express/-/express-<v>.tgz`` becomes
    ``@types/express/-/express-<v>.tgz``. That is the whole identity of the
    artifact; the basename is not, because a scoped and an unscoped package
    whose names share a tail also share one tarball basename.
    """
    path = urllib.parse.urlparse(tarball_url).path
    stripped = path.lstrip("/")
    if not stripped:
        raise Unproven(f"{tarball_url!r} has no path, so no marker can identify it")
    return stripped


def surface_of_tarball(url: str) -> list[str]:
    """Unpack a published npm tarball and read its surface, tolerantly."""
    _status, payload = _get(url)
    with tempfile.TemporaryDirectory() as work:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            archive.extractall(work, filter="data")
        # npm tarballs root everything under "package/".
        root = Path(work) / "package"
        if not (root / "package.json").is_file():
            raise Unproven(f"{url}: no package/package.json inside the tarball")
        return surface(root, tolerant=True)

