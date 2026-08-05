"""Execute the platform-infra CLI with ``python -m platform_infra``."""

from __future__ import annotations

import sys

from platform_infra.cli import main


def _run() -> None:
    sys.exit(main())


if __name__ == "__main__":
    _run()
