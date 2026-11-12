"""The tiers baseline.py reads a released surface from, besides npm: the git
tags whose declared version matches their name, the surface each tag holds,
and the assets of the repository's GitHub releases."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from registry import GITHUB_API, Unproven, _get
from surface import surface


def git(root: Path, *args: str) -> str:
    result = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True)
    if result.returncode:
        raise Unproven(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def head_sha(root: Path) -> str:
    return git(root, "rev-parse", "HEAD")


def origin_slug(root: Path) -> str | None:
    try:
        url = git(root, "remote", "get-url", "origin")
    except Unproven:
        return None
    url = url.removesuffix(".git")
    for prefix in ("https://github.com/", "git@github.com:", "ssh://git@github.com/"):
        if url.startswith(prefix):
            return url.removeprefix(prefix)
    return None


def newest(versions: list[str]) -> str:
    """Order versions with the rule, so the ordering is its answer, not ours."""
    best = next(iter(versions), "")
    for candidate in versions:
        if candidate == best:
            continue
        result = subprocess.run(
            ("autoversion", "order", "--older", best, "--newer", candidate, "--json"),
            capture_output=True, text=True,
        )
        if result.returncode:
            raise Unproven(
                "autoversion order is unavailable, so several tags cannot be "
                "ranked; refusing to guess which is newest"
            )
        if json.loads(result.stdout).get("newer") == candidate:
            best = candidate
    return best


def tag_declared_version(root: Path, tag: str) -> str:
    """The version package.json declares in the tree the tag points at.

    Raises LookupError saying why the tag declares none: git could not show
    the file, it is not JSON, or it names no version string.
    """
    result = subprocess.run(
        ("git", "show", f"{tag}:package.json"), cwd=root, capture_output=True, text=True,
    )
    if result.returncode:
        raise LookupError(f"git could not show it: {result.stderr.strip()}")
    try:
        manifest = json.loads(result.stdout)
    except ValueError as error:
        raise LookupError(f"it is not JSON: {error}") from error
    version = manifest.get("version") if isinstance(manifest, dict) else None
    if not isinstance(version, str):
        raise LookupError(f"its version is {version!r}, not a string")
    return version


def honest_tags(root: Path) -> list[tuple[str, str]]:
    """(tag, version) pairs whose tree really declares the version the tag claims.

    Tags that cannot be listed raise Unproven: read as no tags, the baseline
    fell back to HEAD as if the repository had never been released.
    """
    listing = git(root, "tag", "--list")
    pairs = []
    for tag in filter(None, (line.strip() for line in listing.splitlines())):
        claimed = tag.removeprefix("v")
        try:
            declared = tag_declared_version(root, tag)
        except LookupError as why:
            print(f"note: tag {tag} has no readable package.json ({why}); skipped", file=sys.stderr)
            continue
        if declared != claimed:
            print(
                f"note: tag {tag} points at a tree declaring {declared}; the tag name "
                "disagrees with its own content, so it is reported and skipped",
                file=sys.stderr,
            )
            continue
        pairs.append((tag, claimed))
    return pairs


def surface_of_tag(root: Path, tag: str) -> list[str]:
    """Read the surface out of `git archive <tag>` -- statically, no tooling."""
    result = subprocess.run(
        ("git", "archive", "--format=tar", tag), cwd=root, capture_output=True,
    )
    if result.returncode:
        raise Unproven(
            f"git archive {tag} failed; on a shallow clone the tag's tree is absent, "
            "which is why the workflow unshallows before calling this"
        )
    with tempfile.TemporaryDirectory() as work:
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:") as archive:
            archive.extractall(work, filter="data")
        return surface(Path(work), tolerant=True)


def github_release_assets(slug: str) -> list[tuple[str, str, str]]:
    """(tag, asset_name, download_url) for every release asset."""
    status, body = _get(f"{GITHUB_API}/repos/{slug}/releases")
    try:
        releases = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        raise Unproven(f"{slug}: the releases API answered http {status} with a non-JSON body") from None
    if not isinstance(releases, list):
        raise Unproven(f"{slug}: the releases API answered http {status}: {releases}")
    found = []
    for release in releases:
        tag = release.get("tag_name") or ""
        for asset in release.get("assets") or []:
            name = asset.get("name") or ""
            url = asset.get("browser_download_url") or ""
            if tag and name.endswith(".tgz") and url:
                found.append((tag, name, url))
    return found


