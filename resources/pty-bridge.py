#!/usr/bin/env python3
"""A pseudo-terminal for NetBase's local shell.

PHP cannot hold a pseudo-terminal open, size it, or run a login shell inside
one, so this small bridge does. NetBase's PtyService spawns it and talks to it
over ordinary pipes:

  * bytes written to this program's stdin are the keystrokes; they are copied
    straight into the shell's terminal,
  * everything the shell draws is copied to this program's stdout,
  * the window size is read from the file named on the command line (NetBase
    rewrites it whenever the browser window changes), and applied to the
    terminal with the ioctl a real terminal would receive.

The shell it opens is a plain interactive login bash. It runs with exactly the
privileges of the account that runs Nextcloud (www-data) — no more — because
this program simply inherits them; it grants nothing.

Usage: pty-bridge.py <size-file> <cols> <rows>
"""

import os
import sys
import pty
import select
import struct
import signal

try:
    import termios
    import fcntl
except ImportError:  # pragma: no cover - POSIX only
    sys.stderr.write('pty-bridge: termios/fcntl unavailable\n')
    sys.exit(2)


def main() -> int:
    if len(sys.argv) != 4:
        sys.stderr.write('usage: pty-bridge.py <size-file> <cols> <rows>\n')
        return 2
    size_file = sys.argv[1]
    try:
        cols = max(1, min(1000, int(sys.argv[2])))
        rows = max(1, min(1000, int(sys.argv[3])))
    except ValueError:
        cols, rows = 80, 24

    pid, fd = pty.fork()
    if pid == 0:
        # Child: become the shell. execvp replaces this process, so nothing
        # below runs in the child.
        os.environ.setdefault('TERM', 'xterm-256color')
        shell = os.environ.get('NETBASE_SHELL', 'bash')
        try:
            os.execvp(shell, [shell, '-il'])
        except OSError:
            try:
                os.execvp('/bin/sh', ['/bin/sh', '-i'])
            except OSError:
                os._exit(127)
        os._exit(127)

    def set_size(c: int, r: int) -> None:
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
        except OSError:
            pass

    set_size(cols, rows)

    def size_mtime():
        try:
            return os.stat(size_file).st_mtime
        except OSError:
            return None

    last_size = size_mtime()
    stdin_open = True

    try:
        while True:
            # Has the shell exited?
            try:
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done == pid:
                    break
            except ChildProcessError:
                break

            watch = [fd, 0] if stdin_open else [fd]
            try:
                readable, _, _ = select.select(watch, [], [], 0.2)
            except (OSError, select.error):
                break

            if fd in readable:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                _write_all(1, data)

            if stdin_open and 0 in readable:
                try:
                    data = os.read(0, 65536)
                except OSError:
                    data = b''
                if not data:
                    # NetBase closed the keystroke pipe; stop reading it but
                    # keep drawing the shell until it exits on its own.
                    stdin_open = False
                else:
                    try:
                        _write_all(fd, data)
                    except OSError:
                        break

            now = size_mtime()
            if now is not None and now != last_size:
                last_size = now
                try:
                    with open(size_file, 'r') as handle:
                        parts = handle.read().split()
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                        set_size(int(parts[0]), int(parts[1]))
                except OSError:
                    pass
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGHUP)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
    return 0


def _write_all(fd: int, data: bytes) -> None:
    while data:
        try:
            n = os.write(fd, data)
        except BlockingIOError:
            continue
        data = data[n:]


if __name__ == '__main__':
    sys.exit(main())
