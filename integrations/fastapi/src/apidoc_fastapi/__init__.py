"""Serve the apidoc API reference and playground from a FastAPI app."""

from .docs import get_apidoc_html, mount_apidoc

__all__ = ["get_apidoc_html", "mount_apidoc"]
__version__ = "0.1.0"
