#!/usr/bin/env python3
"""Wake-on-LAN relay for NetBase in a container.

A Nextcloud that runs in a container behind a bridge (Nextcloud AIO, Docker,
Podman) cannot put a magic packet on the LAN: its broadcast stops at the
bridge. The host it runs on can. This relay runs on the host's own network,
takes magic packets on one UDP port and sends each one out again as a LAN
broadcast. It forwards nothing else — anything that is not a magic packet is
dropped — and it uses only Python's standard library.

    python3 wol-relay.py                      # listen on 0.0.0.0:40009, send to 255.255.255.255:9
    python3 wol-relay.py --listen 172.18.0.1:40009 --to 192.168.1.255:9

Then, in Administration settings -> NetBase -> Wake-on-LAN, choose "This server
sends the packet to an address and port" and enter the host's address as the
container sees it (the bridge's gateway, such as 172.18.0.1, or the host's LAN
address) and the port the relay listens on.

To keep it running on a Docker host, for example:

    docker run -d --name netbase-wol-relay --network host --restart unless-stopped \\
      -v /volume1/docker/wol-relay.py:/wol-relay.py:ro python:3-alpine python3 /wol-relay.py

--network host is what lets the relay reach the LAN. It only listens on the one
UDP port, so it does not get in the way of anything else on the host.

Packets are accepted only from private and loopback addresses, a few per second
at most.
"""

import argparse
import ipaddress
import socket
import sys
import time

SYNC = b"\xff" * 6


def is_magic(data: bytes) -> bool:
    """Six 0xFF bytes and one MAC sixteen times, with an optional 4- or 6-byte SecureOn password."""
    if len(data) not in (102, 106, 108) or data[:6] != SYNC:
        return False
    mac = data[6:12]
    return mac * 16 == data[6:102] and mac not in (b"\x00" * 6, b"\xff" * 6)


def host_port(text: str, default_port: int) -> tuple:
    host, _, port = text.rpartition(":")
    if not host:
        host, port = text, str(default_port)
    ipaddress.IPv4Address(host)
    port = int(port)
    if not 1 <= port <= 65535:
        raise ValueError("port out of range")
    return host, port


def main() -> int:
    ap = argparse.ArgumentParser(description="Relay Wake-on-LAN magic packets onto the LAN.")
    ap.add_argument("--listen", default="0.0.0.0:40009", help="address:port to receive on (default 0.0.0.0:40009)")
    ap.add_argument("--to", default="255.255.255.255:9", help="broadcast address:port to send to (default 255.255.255.255:9)")
    ap.add_argument("--per-second", type=int, default=5, help="most packets relayed per second (default 5)")
    args = ap.parse_args()

    try:
        listen = host_port(args.listen, 40009)
        target = host_port(args.to, 9)
    except ValueError as e:
        print("wol-relay: bad address:", e, file=sys.stderr)
        return 2
    if listen[1] == target[1] and listen[0] in ("0.0.0.0", target[0]):
        # It would hear its own broadcasts and send them again for ever.
        print("wol-relay: listen on another port than the one it sends to", file=sys.stderr)
        return 2

    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    rx.bind(listen)
    tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    print("wol-relay: listening on %s:%d, sending to %s:%d" % (listen + target), flush=True)

    window, count = 0, 0
    while True:
        data, (src, _) = rx.recvfrom(2048)
        addr = ipaddress.IPv4Address(src)
        if not (addr.is_private or addr.is_loopback):
            continue
        if not is_magic(data):
            continue
        now = int(time.time())
        if now != window:
            window, count = now, 0
        count += 1
        if count > args.per_second:
            continue
        tx.sendto(data, target)
        mac = data[6:12].hex(":")
        print("wol-relay: %s asked to wake %s -> sent to %s:%d" % (src, mac, target[0], target[1]), flush=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
