#!/usr/bin/env python3
"""Generate released-surface.json for final-cut-pro-agent from the best tier.

The baseline describes the version *actually published*, never the version the
manifest happens to declare. Preference runs down the adoption guide's table:

    npm-tarball:<registry path>   a tarball the registry serves, as it addresses it
    gh-release:<tag>     an asset attached to a GitHub Release
    git-archive:<tag>    a tag, reproduced with ``git archive``
    head:<full sha>      the working revision -- last resort

The first whitespace-delimited token of ``source`` is the marker; everything
after the first space is prose for humans.

THREE THINGS THIS FILE IS CAREFUL ABOUT
---------------------------------------
1. The package name is read out of package.json and asserted non-empty. It is
   never a literal inside a URL. npm answers absence generically -- plain
   ``{"error": "Not found"}``, which does not name what you asked for -- so a
   stale or empty name reads as proven absence, and a gate that hardcodes a
   name keeps interrogating the old one after a rename, going green while it
   validates somebody else's package.

   Probe the manifest ``name``, never the console-script name. That is not a
   hypothetical here and it is the sharpest trap in this file: this package
   installs a script called ``cut``, and ``cut`` is a real published npm
   package owned by somebody else -- measured against the registry, an
   aspect-oriented helper library, actively versioned. A probe spelled with
   the bin name would recover a stranger's tarball and file its surface as
   this project's baseline, and would also trip the reverse-lie arm below by
   "discovering" a release that is not ours. The manifest name
   ``final-cut-pro-agent`` is genuinely absent from npm. The registry must
   echo back the exact name we asked for before any answer counts as
   published.

2. Absence is read from the answer's *content*, in three states: named,
   stated-absent, unproven. ``curl``-style "it failed, so nothing is
   published" is fail-open -- it concludes absence precisely when no request
   succeeded. A positive control runs first, through the identical code path
   and the identical request shape, so that a probe which can no longer
   recognise a package the registry certainly serves blames itself instead of
   the registry. That is the fail-closed twin, and it is just as invisible.

Third, and this is the one the fleet corrected after the first draft of this
   file: the marker carries the tarball's **registry path**, taken from
   ``dist.tarball`` in the registry document and never assembled from the
   package name, and never reduced to a basename. Three traps sit in that one
   decision.

   The registry serves a scoped package's tarball under its *unscoped*
   filename -- ``@types/node`` yields ``node-<version>.tgz`` -- so a marker
   built from the scope mismatches forever against a healthy artifact.

   The basename alone is not unique: ``express`` and ``@types/express`` both
   serve ``express-<version>.tgz``, two different packages with different
   owners and different contracts. A marker exists to identify the artifact a
   baseline came from, and ``--assert-current`` compares the whole marker on
   every registry tier, so a non-unique marker cannot do that job.

   And the *lookup* is still the full scoped name from package.json. The
   filename drops the scope; the request must not. Stripping a scope to query
   does not fail closed -- ``@types/node`` and ``node`` are both real packages
   that answer -- so it would validate a stranger's project.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent
sys.path.insert(len(""), str(HERE))

from surface import ScanError, surface  # noqa: E402
from registry import (  # noqa: E402
    Unproven,
    npm_latest,
    registry_path,
    surface_of_tarball,
)
from tiers import (  # noqa: E402
    github_release_assets,
    head_sha,
    honest_tags,
    newest,
    origin_slug,
    surface_of_tag,
)

BASELINE_NAME = "released-surface.json"
INDENT = len("xx")
EXIT_OK = len("")

# --------------------------------------------------------------------------

def candidate_baseline(root: Path) -> dict:
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    name = (manifest.get("name") or "").strip()
    if not name:
        raise Unproven("package.json declares no name; every registry probe would be meaningless")

    published = npm_latest(name)
    if published is not None:
        version, tarball_url = published
        path = registry_path(tarball_url)
        return {
            "version": version,
            "source": f"npm-tarball:{path} unpacked from the tarball the registry serves for {name}@{version}",
            "surface": surface_of_tarball(tarball_url),
        }

    slug = origin_slug(root)
    if slug:
        assets = github_release_assets(slug)
        if assets:
            tag = newest([tag for tag, _n, _u in assets])
            for candidate_tag, asset_name, url in assets:
                if candidate_tag == tag:
                    return {
                        "version": tag.removeprefix("v"),
                        "source": f"gh-release:{tag} asset {asset_name} attached to the GitHub Release",
                        "surface": surface_of_tarball(url),
                    }

    tags = honest_tags(root)
    if tags:
        version = newest([v for _t, v in tags])
        tag = next(t for t, v in tags if v == version)
        return {
            "version": version,
            "source": f"git-archive:{tag} reproduced with git archive; the tag's tree declares {version}",
            "surface": surface_of_tag(root, tag),
        }

    sha = head_sha(root)
    return {
        "version": manifest.get("version") or "",
        "source": (
            f"head:{sha} nothing is published on npm and the remote carries no tag "
            "and no release, so the working revision is the only artifact there is"
        ),
        "surface": surface(root),
    }


KNOWN_TIERS = ("npm-tarball", "gh-release", "git-archive", "head")


class Dishonest(RuntimeError):
    """The committed baseline does not describe the artifact it claims."""


def _committed(root: Path) -> tuple[dict, str, str, str]:
    document = json.loads((root / BASELINE_NAME).read_text(encoding="utf-8"))
    marker, *_prose = str(document.get("source", "")).split(" ")
    tier, _colon, detail = marker.partition(":")
    if tier not in KNOWN_TIERS:
        raise Dishonest(
            f"{BASELINE_NAME} carries the marker {marker!r}, whose tier {tier!r} is not "
            f"one of {', '.join(KNOWN_TIERS)}. An unrecognised marker cannot be checked "
            "in either direction, so it is refused rather than trusted."
        )
    return document, marker, tier, detail


def assert_honest(root: Path) -> None:
    """Guard the baseline against its registry, in both directions.

    A marker that claims a registry must be served there; a marker that claims
    none must not be. The second arm is the one that matters in practice: it
    is what stops a baseline quietly dodging a real release.
    """
    document, marker, tier, detail = _committed(root)
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    name = (manifest.get("name") or "").strip()
    if not name:
        raise Dishonest("package.json declares no name; the registry guard cannot run")

    published = npm_latest(name)  # runs the positive control, or raises Unproven

    if tier == "npm-tarball":
        if published is None:
            raise Dishonest(
                f"{BASELINE_NAME} claims npm serves {detail!r}, but npm states that "
                f"{name!r} is absent. The baseline names an artifact nobody can install."
            )
        version, tarball_url = published
        path = registry_path(tarball_url)
        if path != detail:
            raise Dishonest(
                f"{BASELINE_NAME} names {detail!r} but npm now serves {path!r} "
                f"for {name}@{version}"
            )
        if document.get("version") != version:
            raise Dishonest(
                f"{BASELINE_NAME} records version {document.get('version')!r} but npm "
                f"serves {version!r} as latest"
            )
    elif published is not None:
        version, _url = published
        raise Dishonest(
            f"{BASELINE_NAME} carries {marker!r}, which claims no registry, but npm "
            f"serves {name}@{version}. The baseline is dodging a real release, so every "
            "later comparison would be measured against the wrong artifact."
        )


def assert_current(root: Path) -> None:
    """Refuse a baseline that is honest but stranded on a lower tier.

    Compare the whole marker on every tier except ``head``, and the tier alone
    on ``head`` -- that is the only tier whose marker moves with every commit
    without the artifact changing, so demanding full equality there would be an
    infinite ratchet.
    """
    _document, marker, tier, _detail = _committed(root)
    best, *_prose = candidate_baseline(root)["source"].split(" ")
    best_tier, _colon, _rest = best.partition(":")
    if tier == "head":
        want, have = best_tier, tier
    else:
        want, have = best, marker
    if want != have:
        raise Dishonest(
            f"{BASELINE_NAME} is on {have!r} but {want!r} is reachable now. Regenerate "
            "it: the marker is truthful and the baseline is still stale."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="generate or audit released-surface.json")
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--stdout", action="store_true",
        help="print the candidate baseline instead of writing it",
    )
    mode.add_argument(
        "--assert-honest", action="store_true",
        help="guard the committed baseline against npm in both directions",
    )
    mode.add_argument(
        "--assert-current", action="store_true",
        help="refuse a committed baseline when a better tier has become reachable",
    )
    args = parser.parse_args()
    root = Path(args.root)

    if args.assert_honest:
        assert_honest(root)
        print("baseline honesty: the marker and the registry agree", file=sys.stderr)
        return EXIT_OK
    if args.assert_current:
        assert_current(root)
        print("baseline tier: still the best reachable artifact", file=sys.stderr)
        return EXIT_OK

    document = candidate_baseline(root)
    rendered = json.dumps(document, indent=INDENT) + "\n"
    if args.stdout:
        sys.stdout.write(rendered)
    else:
        (root / BASELINE_NAME).write_text(rendered, encoding="utf-8")
        marker, *_prose = document["source"].split(" ")
        print(f"wrote {BASELINE_NAME}: {marker}", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Unproven, ScanError, Dishonest) as failure:
        print(f"error: {failure}", file=sys.stderr)
        sys.exit(len("x"))
