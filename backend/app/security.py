"""SSRF protection for user-supplied URLs."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from .errors import UserError

_ALLOWED_PORTS = {None, 80, 443}


def _is_public(ip_str: str) -> bool:
    ip = ipaddress.ip_address(ip_str.split("%")[0])
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def assert_public_url(url: str) -> str:
    """Raise UserError unless the URL is http(s) and resolves only to public IPs."""
    p = urlparse((url or "").strip())
    if p.scheme not in ("http", "https"):
        raise UserError("Only http(s) links are supported.")
    if not p.hostname or p.username or p.password:
        raise UserError("That doesn't look like a valid link.")
    try:
        port = p.port
    except ValueError:
        raise UserError("That doesn't look like a valid link.")
    if port not in _ALLOWED_PORTS:
        raise UserError("Only standard web ports (80/443) are allowed.")
    try:
        infos = socket.getaddrinfo(
            p.hostname, port or (443 if p.scheme == "https" else 80), proto=socket.IPPROTO_TCP
        )
    except socket.gaierror:
        raise UserError("Couldn't resolve that address.")
    for info in infos:
        if not _is_public(info[4][0]):
            raise UserError("That address isn't allowed.")
    return p.geturl()
