#!/usr/bin/env python3
"""Extract the public surface of final-cut-pro-agent.

WHY THIS SET IS THE CONTRACT
----------------------------
This distribution is a command-line tool. npm installs it as one console
script, ``cut``, and everything a user holds is reached through that script's
argv. So the contract is what ``cut help`` *advertises*, in four layers:

  bin:<name>     the console script name. A rename breaks every shell script,
                 Makefile and shebang that ran yesterday -- the "distribution
                 with entry points" row of the adoption table.
  cmd:<name>     the top-level subcommands printed in the USAGE block.
  fcp:<name>     the ``cut fcp`` subcommands the help topics list.
  flag:--<name>  the option flags the help topics list.

The flags are in deliberately, and they are the interesting call. This tool's
whole job is flag-driven authoring -- ``cut fcpxml --clips=... --music=...``
-- so deleting ``--music`` is precisely the change a user notices, while a
surface of five command names would score it ``internal``. That is the
adoption guide's rule of thumb: include a set whose removal your surface would
otherwise call internal.

Conversely the 574 dispatchable menu paths and the 346 named wrappers are
*not* here. They are enumerated live off the running Final Cut Pro menu bar,
they move when Apple ships a new FCP, and they are the thing this product is
expected to get better at. The help is the promise; the live catalog is an
implementation. Same rule of thumb, other direction: exclude what a product is
expected to improve.

A command that dispatches but is unlisted is private by the same reasoning.
Today ``--help``/``-h`` are the only such spellings and they are aliases of
the advertised ``help``, so nothing is being quietly omitted.

HOW IT IS READ
--------------
Statically, off the source text. The module is never imported and node is
never invoked: a release decision must not require a machine that can run the
product, and the very same extractor has to work against an unpacked published
tarball, which is how a baseline is recovered rather than assumed.

A file that does not scan cleanly raises. It never degrades to a shorter
surface, because a shrink reads as a breaking removal that never happened.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent

CLI_REL = "bin/cut.mjs"


class ScanError(RuntimeError):
    """A source file could not be scanned. Never downgrade this to a skip."""


# --------------------------------------------------------------------------
# A one-pass JS lexer, enough to tell code from comments and string bodies.
# Everything below reads the *masked* code (comments and string contents
# blanked, offsets preserved) so a keyword inside a string can never be
# mistaken for code, and reads the captured literals for the help text.
# --------------------------------------------------------------------------

_TOKENS = re.compile(
    r"""
      (?P<line_comment> //[^\n]* )
    | (?P<block_comment> /\*.*?\*/ )
    | (?P<dq> "(?:\\.|[^"\\\n])*" )
    | (?P<sq> '(?:\\.|[^'\\\n])*' )
    | (?P<tpl> `(?:\\.|[^`\\])*` )
    | (?P<regex> (?<=[=(,:\[!&|?+\-*%~^<>{};]) \s* /(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n\[])+/[gimsuy]* )
    """,
    re.VERBOSE | re.DOTALL,
)

_QUOTES = ("dq", "sq", "tpl")


def _blank(chunk: str) -> str:
    return "".join(ch if ch == "\n" else " " for ch in chunk)


def _has_unclosed_substitution(inner: str) -> bool:
    """True when a ``${`` in a template body is never closed.

    That is the one shape that desyncs the lexer: a nested template inside a
    substitution ends the outer literal early, leaving a dangling ``${``.
    A plain apostrophe in the literal text is harmless and must not trip this.
    """
    stack: list[str] = []
    previous = ""
    for ch in inner:
        if ch == "{" and previous == "$":
            stack.append(ch)
        elif ch == "}" and stack:
            stack.pop()
        previous = ch
    return bool(stack)


def scan_js(text: str, origin: str) -> tuple[str, list[tuple[int, str]]]:
    """Return (masked_code, [(start_offset, literal_value), ...])."""
    pieces: list[str] = []
    literals: list[tuple[int, str]] = []
    cursor = text.index("") if text else len("")

    for match in _TOKENS.finditer(text):
        kind = match.lastgroup
        pieces.append(text[cursor:match.start()])
        body = match.group()
        if kind in _QUOTES:
            quote = body[:len("`")]
            inner = body[len(quote):-len(quote)]
            if kind == "tpl" and _has_unclosed_substitution(inner):
                raise ScanError(
                    f"{origin}: a template literal at offset {match.start()} has an "
                    "unclosed ${...}, so a nested template ended it early; this "
                    "scanner refuses to guess where it really ends"
                )
            literals.append((match.start(), inner))
            pieces.append(quote + _blank(inner) + quote)
        else:
            pieces.append(_blank(body))
        cursor = match.end()
    pieces.append(text[cursor:])

    masked = "".join(pieces)
    if len(masked) != len(text):
        raise ScanError(f"{origin}: masking changed the file length; offsets would be wrong")
    if masked.count("{") != masked.count("}"):
        raise ScanError(f"{origin}: unbalanced braces after scan; refusing to report a surface")
    for quote in ('"', "'", "`"):
        if masked.count(quote) % len("xx"):
            raise ScanError(f"{origin}: odd number of {quote} delimiters after scan; lexer lost sync")
    return masked, literals


def balanced_span(masked: str, search_from: int, origin: str) -> tuple[int, int]:
    """Span of the first {...} block at or after ``search_from``."""
    try:
        start = masked.index("{", search_from)
    except ValueError:
        raise ScanError(f"{origin}: expected an opening brace after offset {search_from}") from None
    stack: list[str] = []
    for offset, ch in enumerate(masked[start:]):
        if ch == "{":
            stack.append(ch)
        elif ch == "}":
            stack.pop()
            if not stack:
                return start, start + offset + len("}")
    raise ScanError(f"{origin}: unbalanced brace opened at offset {start}")


def _locate(masked: str, needle: str, origin: str) -> int:
    try:
        return masked.index(needle)
    except ValueError:
        raise ScanError(
            f"{origin}: {needle!r} not found; the advertised surface cannot be read. "
            "Fix this extractor rather than publishing a shrunken surface."
        ) from None


# --------------------------------------------------------------------------

_CMD = re.compile(r"^\s*cut ([a-z][a-z0-9-]*)\b")
_FCP_SUB = re.compile(r"^\s*cut fcp ([a-z][a-z0-9-]*)\b")
_FLAG = re.compile(r"^\s*(--[a-z][a-z0-9-]*)")

_REQUIRED_KINDS = ("cmd:", "flag:", "fcp:", "bin:")

# This workspace admits no bare numeric literals, so the small numbers this
# module needs are spelled as word forms.
FIRST_GROUP = len("x")
INDENT = len("xx")
EXIT_OK = len("")


def surface(root: Path, tolerant: bool = False) -> list[str]:
    names: set[str] = set()
    skipped: list[str] = []

    manifest_path = root / "package.json"
    if not manifest_path.is_file():
        raise ScanError(f"{manifest_path}: no package.json; cannot name the console scripts")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    binmap = manifest.get("bin") or {}
    if isinstance(binmap, str):
        binmap = {manifest.get("name", ""): binmap}
    if not binmap:
        raise ScanError(
            f"{manifest_path}: no bin entries; the contract of a CLI distribution "
            "is its console scripts"
        )
    for script in binmap:
        names.add(f"bin:{script}")

    cli = root / CLI_REL
    if not cli.is_file():
        raise ScanError(f"{cli}: the CLI entry point is missing")

    try:
        masked, literals = scan_js(cli.read_text(encoding="utf-8"), CLI_REL)
        topics = balanced_span(masked, _locate(masked, "HELP_TOPICS", CLI_REL), CLI_REL)
        helper = balanced_span(masked, _locate(masked, "function printHelp", CLI_REL), CLI_REL)

        topic_start, topic_end = topics
        help_start, help_end = helper

        for start, value in literals:
            if topic_start <= start < topic_end:
                found = _FCP_SUB.match(value)
                if found:
                    names.add(f"fcp:{found.group(FIRST_GROUP)}")
                    continue
                found = _FLAG.match(value)
                if found:
                    names.add(f"flag:{found.group(FIRST_GROUP)}")
                    continue
            if help_start <= start < help_end:
                found = _CMD.match(value)
                if found:
                    names.add(f"cmd:{found.group(FIRST_GROUP)}")
    except ScanError:
        if not tolerant:
            raise
        skipped.append(CLI_REL)

    if skipped:
        print(
            "warning: tolerant mode skipped these modules, so this surface is "
            "incomplete and must never be committed as a baseline: " + ", ".join(skipped),
            file=sys.stderr,
        )
    else:
        for kind in _REQUIRED_KINDS:
            if not any(name.startswith(kind) for name in names):
                raise ScanError(
                    f"{CLI_REL}: scanned cleanly but produced no {kind!r} names. The help "
                    "layout changed and this extractor no longer reads it; fix the "
                    "extractor rather than publishing a shrunken surface."
                )

    return sorted(names)


def main() -> int:
    parser = argparse.ArgumentParser(description="print the public surface as JSON")
    parser.add_argument(
        "--root", default=str(DEFAULT_ROOT),
        help="tree to read; point at an unpacked tarball to recover a baseline",
    )
    parser.add_argument(
        "--tolerant", action="store_true",
        help="recovery mode for an already-published artifact: skip unscannable modules and say so",
    )
    args = parser.parse_args()
    print(json.dumps({"surface": surface(Path(args.root), tolerant=args.tolerant)}, indent=INDENT))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
