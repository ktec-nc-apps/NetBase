# NetBase

Network toolbox for Nextcloud — fast LAN device discovery with vendor lookup, plus DNS, whois, TLS, mail, file-transfer and benchmark tools.

NetBase turns your Nextcloud into a network console. It finds every device on your LAN, tells you what each one is, opens each one's own settings page from inside Nextcloud, and keeps the everyday lookup tools on the same screen.

## What each part is built on, and what it is for

### Device windows

**How it works.** The server fetches the device's own page and rewrites every address inside it — links, stylesheets, scripts, forms, redirects, meta refreshes, and the ones the page's scripts build while it runs — so the whole interface arrives on Nextcloud's address instead of the device's. Each window carries a signed ticket naming the address, the person and an expiry, and the device's session is held on the server, so signing in survives from page to page. Only private-range addresses, this server's own addresses, or hosts a scan has actually seen can be opened; the page is pinned by policy to the proxy's own path, and sandboxed against navigating anything but itself.

**What it is for.** Changing a branch router's settings from somewhere else entirely. Reading a printer's toner levels and its tray configuration. Sending new firmware or restoring a saved configuration. Supporting a customer's equipment without a VPN, a jump host or a site visit. Several windows can be open at once, moved and resized, each remembering where it has been.

**When a page does not work.** Some device pages come up blank in the window, or do nothing when clicked. The window's **Diagnose** button (top right) loads the page again from the start and records what happens until **Finish** is pressed: the requests the server carried and what came back, the device's headers that NetBase does not pass on to the browser, and the page's errors, clicks and form submissions. It keeps no passwords, nothing typed into the page and none of its text, and hides the values after "?" in every address, so the report can be pasted into a bug report as it stands.

### Device discovery and inventory

**How it works.** Nextcloud runs unprivileged, so raw sockets — and therefore ARP scanning in PHP — are not available. NetBase makes the kernel do the work instead: sending a datagram to an on-link address forces the kernel to resolve it, and the result lands in the neighbour table, which is world readable. Names come from the devices themselves over NetBIOS, mDNS, WS-Discovery and SSDP, all plain UDP, and vendors from the bundled IEEE registries — more than 53,000 prefixes, so no MAC address is ever sent anywhere. Open ports are checked at one of five depths, from a short list of fifteen that keeps a sweep quick to every one of the 65,535. NetBase also listens, continuously and in the background, to the announcements devices make to the multicast group: those are carried at the level of the wire, so a device on a different subnet of the same cable — a camera left on its factory address, say — is found even though nothing can route to it and it can never answer a question. The server NetBase runs on is written down too; a machine never asks the network for its own address, so it is never in its own neighbour table. A sweep, and the port scan of a single device, stay on the local network — a private address range, or a network this server is attached to; a public range is refused.

**What it is for.** Building the asset list a site never quite had. Finding the device nobody remembers installing. Seeing which addresses are free before assigning one. Exporting the lot as CSV for an inventory that lives outside Nextcloud. When a device is switched off its neighbour entry can linger; an optional helper an administrator installs (a one-line sudoers rule — the app shows the exact script, and it is entirely optional) lets NetBase clear the table so a refresh reflects only what is live now.

### DNS

**How it works.** Queries are built as raw DNS packets, so record types PHP's own resolver cannot return — TLSA, DS, DNSKEY, SSHFP, CAA, SVCB — come back with the reply's flags intact. The same question can be put to several resolvers at once, traced down from the root servers, or asked as a zone transfer.

**What it is for.** Watching a migration take effect. Explaining why one office resolves a name differently from another. Checking that your name servers do not hand the whole zone to strangers.

### Whois and free-domain search

**How it works.** IANA is asked first, then the registry it names, then the registrar it names — the referral chain followed to the end, over plain sockets. No `whois` binary is required.

**Free-domain search.** Type a name without its ending and NetBase checks it across a whole range of endings at once — the common ones (48), all gTLDs, all ccTLDs, or everything (~1,180) — using DNS delegation first, then RDAP, then WHOIS. Each ending is marked free (○), taken (×, with a Whois button that opens its registration), likely-free (△), or could-not-check (?) when a registry rate-limits or refuses the query. The taken and the could-not-check results can each be hidden with a switch, results flow into two or three columns on a wide screen, and the whole list can be copied, downloaded or saved.

**What it is for.** Expiry dates before they surprise you. Who to contact about an address that is causing trouble. Which registrar a domain actually sits at, before a transfer. Finding a domain name that is still free, without visiting a registrar.

### TLS and HTTP

**How it works.** The certificate, its chain and its expiry are read from the negotiated stream; each TLS version is offered separately to see which are still accepted; the redirect chain and the response headers are fetched and assessed.

**What it is for.** Certificate expiry before the browser shouts about it. Old TLS versions that fail an audit. Finding out where a redirect really ends.

### Subnet and MAC

**How it works.** Address arithmetic for IPv4 and IPv6, including splitting a network into smaller ones and reducing a scattered list to the fewest CIDR blocks. MAC lookups use the same bundled registries as discovery.

**What it is for.** Planning a re-addressing. Writing a firewall rule that covers exactly what it should. Identifying equipment from a MAC address in a log.

### Benchmarks

**How it works.** Interface counters are read from the kernel and differentiated in the browser; the LAN test drives `iperf3`; the internet test measures the path to a public endpoint; resolvers are timed side by side; one HTTP request is broken into DNS, connect, TLS, waiting and transfer.

**What it is for.** Turning "the network is slow" into a number. Telling a slow switch port from a slow internet connection. Before-and-after evidence when equipment or a provider changes.

### Mail

**How it works.** SMTP, IMAP and POP3 are spoken directly over stream sockets, so `ext-imap` — which no longer ships with current PHP — is neither needed nor used. The DNS side reads MX, SPF, DKIM, DMARC, MTA-STS (fetching the policy file), TLS-RPT, BIMI and DANE, and checks each MX address against seven public blocklists.

The same page reads and sends mail on a saved account or one typed in: folders, search, read and unread, flags, move, delete, and new messages, replies and forwards with attachments from your Nextcloud files.

**What it is for.** Working out why mail is not arriving. Checking a migration before and after. Proving the anti-spoofing records are right, and that the server is not an open relay. Reading and answering a mailbox on a server you look after, without setting up a mail program.

### FTP, SFTP and SCP

**How it works.** SFTP and SCP use the phpseclib 3 copy NetBase carries with it — Nextcloud ships only phpseclib 2, which cannot read a modern private key; FTP uses PHP's own extension, with or without TLS. Transfers stream through a file handle in both directions, so a large file never lands in PHP's memory. A saved SSH connection can be browsed here as it stands: it is the same machine, account and key, so NetBase opens it over SFTP, or over SCP for a server that offers a shell but no SFTP subsystem. **Change user** acts as another account on the far end — root, www-data or any other — through `sudo`, over SCP, and opens that account's home folder; stopping goes back to where you were. The password is asked for on the spot, used for that one request, and kept nowhere — not in the settings, not in RegiBase, not on disk — so reloading the page asks again. A server where sudo asks for no password needs none here either. Connection details live in RegiBase, sealed with your own master key, and a connection can also be typed in on the spot.

**What it is for.** Pushing a configuration file to a device or a server. Collecting logs. Unpacking an archive on the server, or fixing a file saved in the wrong encoding. Moving files between a remote server and your own Nextcloud folders without a laptop in the middle.

### SSH and Telnet

**How it works.** The probe reads what a server offers before anything is encrypted — its identification string, its algorithm list, its host key fingerprint — so it needs no credentials at all. The signed-in half uses phpseclib with a password or a private key, either typed in or picked from your own Nextcloud files. PHP cannot hold a session open between requests, so the terminal keeps the session on the server and streams it to the browser.

**What it is for.** Checking a branch server's disk, failed services and pending updates without opening a terminal — or opening a real one and editing a file in `vi`. Auditing which SSH algorithms are still offered. Seeing what a Telnet port exposes — and being told plainly what leaving it open means.

### Clock check

**How it works.** An NTP server is asked for the time over UDP and the offset is reported.

**What it is for.** Ruling the clock in or out. A drifted clock is behind more certificate and sign-in failures than anything else.

### System information

**How it works.** This server's interfaces, addresses, routes, resolvers and listening sockets, alongside a list of which tools work right now and which would start working if a package were installed — with the install command for the package manager this machine actually has.

**What it is for.** Knowing what you are standing on. Getting a dormant capability working without hunting through documentation.

### Keeping what you found

**How it works.** Every tool's findings can be copied to the clipboard, downloaded as a text file, or written straight into a **NetBase** folder in your own Nextcloud files — named by tool and timestamp, and never over the top of an earlier one. The device list also exports as CSV.

**What it is for.** Attaching the evidence to a ticket. Keeping a before-and-after pair around a change. Handing a colleague the exact output rather than a description of it.

### AI assistant

**How it works.** A chat that knows NetBase and explains what is on the screen — a scan, a ping, a list of devices — in the person's own language, through the free **AI-Hub** app, where the AI service, its key and its limits are set once for every app on the server. It runs nothing itself. Administrators who switch it on can let it suggest commands, and a command runs only after the person approves that very command by typing `approve` and the code shown for it. Without AI-Hub it is simply not shown.

**What it is for.** Reading an unfamiliar scan result, a trace or an error without searching for it.
### Access, appearance and language

**How it works.** NetBase is an administrator's app, and everything that touches the local network — the device windows, the sweep, Wake-on-LAN, mail tests, FTP, SFTP, SSH, the device list itself — defaults to administrators. But every tool has its own level, set in **Administration settings → NetBase**: administrators only, administrators plus named groups, or every signed-in account. Any of them can be opened up, including the ones that ship closed. Where an account is allowed nothing at all, NetBase leaves itself out of that account's app menu rather than advertising a door that will not open. The theme and the language are per account, and the sidebar can be dragged into whatever order suits the work.

**What it is for.** Letting the helpdesk run a whois or a DNS lookup without giving them the network. Opening the device list to a named group during a migration, and closing it again afterwards.

## Benchmarks

| Measurement | What it tells you | Needs |
|---|---|---|
| **Live throughput** | Receive and send rates per interface, with a running graph and the interface error/drop count | nothing |
| **Internet speed test** | Download and upload in Mbps, plus connect latency and jitter | `ext-curl` |
| **LAN throughput** | The real speed of the local link, in both directions, with a per-second graph and the retransmit count | `iperf3` here and on one other machine |
| **DNS resolver comparison** | Median, average and jitter for every resolver, including the one this server uses, with the fastest marked | nothing |
| **Where the time goes** | One HTTP request broken into DNS, TCP, TLS, server think-time and transfer | `ext-curl` |
| **Transfer speed to a saved connection** | The real send and receive speed to a saved SFTP, SCP or FTP server, with 1 MB to 1 TB of data | a saved connection |

Two of these deserve a note.

**Live throughput** is read from the kernel's own counters in `/proc/net/dev`, so it costs nothing, needs no capture privileges and cannot miss traffic. It is differentiated in the browser, which is why a timestamp travels with each sample.

**The internet speed test is not a LAN test.** It measures the path to a public endpoint, and you choose which one: [M-Lab](https://www.measurementlab.net/) (the measurement behind Google's own speed test) or [Cloudflare](https://speed.cloudflare.com/). Left on *Nearest (automatic)* it uses M-Lab and falls back to Cloudflare only where M-Lab cannot be reached at all. The two are both offered because a network that reaches one may not reach the other — M-Lab needs an outbound WebSocket — and because two independent readings of the same line are worth more than one. An M-Lab measurement picks its server by asking the nearest few directly and keeping the one that answers quickest, which is not always the one M-Lab's own list puts first; latency is then timed against that same machine, so the round trip belongs to the server the throughput came from. The interface names the host and its city before anything is transferred. To measure the local link, use the iperf3 test: it is the only honest way to tell a slow switch port from a slow internet connection. **A reading is an indication, not a verdict** — it moves with the time of day and with which server answered.

## Mail

Three views, in the order you actually need them.

**Domain policy** takes a domain name and reads everything DNS publishes about its mail: the MX hosts with their addresses and reverse names (checked both ways, because receivers do), SPF with its terms and its DNS-lookup count against the limit of ten, DMARC with its policy and reporting address, DKIM keys with their size, MTA-STS (including fetching the policy file over HTTPS), TLS-RPT, BIMI, DANE/TLSA records, the client autoconfiguration SRV records, and each MX address against seven public blocklists. It ends with a ranked list of findings in plain language — what is broken, what is worth looking at, what is fine.

**Server test** talks to one server and reports what it offers: the greeting, the capability list, whether STARTTLS is there and what the certificate looks like once it is, the negotiated protocol and cipher, and the sign-in mechanisms. One-click presets cover ports 25, 587, 465, 993, 143 and 995. The full conversation is kept and shown on request, with credentials masked. Two extras sit under it: an **open-relay test** — a foreign sender and a foreign recipient offered to the server, stopping before anything is sent — and a **blocklist lookup** for any address.

**Send and receive** proves the thing people actually care about, and works as a basic mail program. Pick a saved SMTP connection and send a real test message; pick a saved IMAP or POP3 account, or type one in, to see the folders and the messages. A message can be searched for and opened — HTML is shown without scripts and without fetching outside images, and attachments can be saved to your Nextcloud files — marked read or unread, flagged, moved, or deleted, to the trash first. New messages, replies, replies to all and forwards can be written, with Cc, Bcc and attachments from your Nextcloud files, and a copy is filed in Sent. Opening a message marks it as read unless that is turned off; reading over POP3 leaves it unread on the server.

Every protocol here is spoken directly over a stream socket. `ext-imap` is neither needed nor used, which matters because it no longer ships with current PHP.

## SSH: probe and command

Two halves, deliberately separate.

**The probe needs no credentials.** The identification string and the KEXINIT packet a server sends before anything is encrypted give the complete algorithm list, and the host key fingerprint comes from a key exchange. Findings call out what should no longer be offered — SHA-1 key exchange and MACs, CBC ciphers, RC4, DSA, RSA host keys under 2048 bits, protocol 1. Asking which sign-in methods are accepted is a separate checkbox, because it leaves one failed attempt in the other machine's log.

**The command half signs in** to a saved connection with its password or private key and runs one command, returning the output and the exit status. Presets cover the questions asked most often — a system snapshot, disk usage, failed services and recent errors, network configuration, listening sockets, pending updates, who is logged in and who failed — and there is a free-form command box next to them.

**The terminal** is the real thing. PHP-FPM ends every request, so the session is held by the server rather than by the page: the browser opens one long-lived request that the answer streams down, and what is typed goes up alongside it, one batch at a time so that keystrokes cannot overtake each other. The far end is a proper pseudo-terminal, so `top`, `vi`, `less` and an interactive password prompt all work, colours and cursor movement work, and resizing the window resizes the terminal. It can be opened from a device's port 22, from the SSH page, or from the notice on a device that is out of reach — where the command that would reach it is waiting to be run on this server.

**Terminal settings**, after TeraTerm's setup menus, are in Settings → Terminal: the terminal type the server is told (xterm-256color unless a device asks for another), the character encoding both ways for an older server or device that speaks Shift_JIS, EUC-JP and the like, environment variables sent with the shell as OpenSSH's SendEnv does (a server takes only the names its AcceptEnv allows, usually LANG and LC_*), a keep-alive for routers and firewalls that drop a quiet connection, what Enter and Backspace send, the scrollback and the cursor.

**Signing in** asks for the host, the port, the account, and either a password or a private key from your own Nextcloud files. A default folder for keys can be set in Settings, so the picker opens where they are kept.

## Files: FTP, SFTP and SCP

Choose a saved connection, or type one in, and browse it: directories, sizes, timestamps, permissions and owners, with a path bar you can type into. Your Nextcloud files are on the left and the server on the right; choose rows and press **Send** or **Receive**, or drag them from one side to the other. Right-click a row for the rest: open, download, rename, copy or move it on the server, compress or extract it, convert its text, change its permissions (and, for a folder, those of the files or the folders inside), its owner or its group, set its time to now, or copy its path or URL.

When a name is already taken, you are asked what to do: overwrite, overwrite if newer, overwrite if the size differs, resume, keep both, or skip — for that file or for all the rest. An interrupted transfer can be resumed and a failed one retried, file times can be kept, and each direction can be given a speed limit. The list can be filtered (`*` and `?` work) and the server searched; the two sides can be compared and browsed together; each connection keeps its own bookmarks; and the keyboard works (Del, F2, F5, Enter, Backspace, Ctrl+A and the arrows).

**Compressing and extracting** uses the tools the server has — zip, tar, gzip, bzip2, xz, zstd, 7-Zip, unrar — and offers ZIP, tar, tar.gz, tar.bz2, tar.xz, tar.zst, 7z, gz, bz2, xz and zst, and RAR for extracting. A format the server cannot handle is shown greyed out, with the reason. Where there is no shell (FTP, or an SFTP-only account), ZIP, tar, tar.gz and tar.bz2 are made and opened on the Nextcloud server instead. An archive is extracted into a new folder unless you choose otherwise, and extracting in place keeps what is already there unless you choose to overwrite.

**Converting text** detects the current encoding — UTF-8, UTF-16, Shift_JIS, EUC-JP, ISO-2022-JP, GB18030, Big5, EUC-KR, Windows-1252, ISO-8859-1, Windows-1251 or KOI8-R — and changes the encoding, the line endings and the BOM. A character the new encoding cannot hold is named before anything is written, and the result is saved under a new name unless you choose to overwrite. It handles files of up to 32 MB.

Transfers stream through a file handle in both directions, so a large file never lands in PHP's memory.

FTP uses PHP's own `ext-ftp`, with or without TLS. SFTP and SCP use the phpseclib 3 copy NetBase carries with it, so nothing extra is installed, and both sign in with either a password or a private key — see **Saved connections** for where the key goes. SCP is there for the server that offers SSH without the SFTP subsystem: it has no directory listing of its own, so NetBase reads one over the shell and presents it exactly as SFTP's.

## Telnet and the clock

**Telnet** sits with the tools for working on a server rather than the ones for looking at it: the window signs in, sends a line and reads the answer, a connection per line, so nothing is left open on the device in between. The credential-free probe is still there under the looking half — it answers the option negotiation politely and shows you the login screen, which is usually enough to tell which device it is, and the finding says what Telnet being open means.

**Clock check** asks an NTP server for the time and reports the offset. A drifted clock is behind more certificate and sign-in failures than anything else, and this is the fastest way to rule it in or out.

## The shell log

Every line typed into a shell or an SSH window, together with what came back, can be kept — **off by default**, because a terminal log is a record of somebody working, and that is theirs to choose. Switch it on under **Settings → Terminal (shell and SSH)**.

A *step* is one line you typed and the answer to that line. The answer arrives after the Return that asked for it, so a step is closed by the *next* Return, not by its own — a subtlety that is easy to get wrong and easy to test wrongly. Two limits decide what is kept: how many steps per window (5,000 by default) and how many days (counted from a window's **last** step, so a session still in use is never cut short; when the days run out, that whole session goes). Colours, cursor moves and window titles are taken out; the words are kept. A very long step is shortened from the middle, keeping both ends.

## Saved connections

The mail and file tools work from saved connections: type, host, port, encryption mode, user name and credential. They belong to the account that created them — there is no shared pool, because a stored password is one person's credential, not the instance's.

**Where the private key goes.** Choose *Private key* under **Sign in with** — it is offered for SSH and SFTP connections. Then either give the path of the key inside your own Nextcloud files (`Keys/id_ed25519`, the file without `.pub`), in which case the server reads it when you save and the key never passes through the browser at all, or paste the key into the box below that field. A passphrase, if the key has one, goes in the field next to the user name. OpenSSH and PEM formats are both accepted.

Each kind of connection names its own collection and its own field assignment: SSH, SCP, FTP-and-SFTP, and mail. The screens follow that division: choosing SCP shows the SCP list, FTP and SFTP share theirs, and SSH keeps its own, so a server saved for one protocol is never offered to another that cannot speak it. SCP reuses the SSH credentials, but FTP is usually a different account on a different machine, so they are not read out of one list. Naming the same collection for several kinds is expressly allowed — SSH and SCP usually are the same list — and a kind that has not been given a collection of its own falls back to the one chosen for everything, so nothing moves until you separate it deliberately.

The password (or private key, with its passphrase) is kept in RegiBase and sealed with **your own master key** — not with a secret this server holds, so nobody reading the database can open it, this server included. The key is asked for when a connection is first used, held for that browser session only, and stored nowhere: not in these settings, not on disk. A credential is **never sent back to the browser**; the interface is told only that one exists. Saving a connection again without retyping the password keeps the stored one. Protocol conversations shown in the interface have their credential lines masked.

## Wake-on-LAN

A device that is switched off answers nothing, so two things have to be known before it can be woken: its MAC address, and something awake on the same LAN to send the magic packet. NetBase remembers the MAC of every device a scan has seen. For a device it has never seen — one that is off, across a router, or seen from inside a container — type the MAC in the device's details, or when adding it by address. A device that is off can be added too, and woken straight away.

How the packet is sent is set in **Administration settings → NetBase → Wake-on-LAN**:

- **This server sends the packet to an address and port.** `255.255.255.255`, port 9, is the usual broadcast and works where Nextcloud runs on the LAN itself. A subnet's own broadcast address (such as `192.168.1.255`) reaches a LAN the server is attached to through another interface.
- **Run a command or script on this server.** `{mac}`, `{MAC}` and `{ip}` are filled in — for example `curl` to a router's or Home Assistant's wake-up address.
- **Run a command on a machine that is always on, through a saved SSH connection** — a NAS or a small server on the LAN with `wakeonlan` or `ether-wake`. The person waking a device picks the connection, and also needs the SSH commands tool.

Only a checked MAC address and IPv4 address are ever put into a command.

**Nextcloud in a container (AIO, Docker, Podman).** A container on a bridge cannot put a broadcast on the LAN: the packet stops at the bridge, though it does reach the host. `resources/wol-relay.py` in this app is a small relay for the host. It takes magic packets on one UDP port (40009 by default) and sends each one out as a LAN broadcast; it forwards nothing else, and it only needs Python's standard library. Run it on the host's own network, for example:

```
docker run -d --name netbase-wol-relay --network host --restart unless-stopped \
  -v /path/to/wol-relay.py:/wol-relay.py:ro python:3-alpine python3 /wol-relay.py
```

Then choose the first way of sending and enter the host's address as the container sees it (the bridge's gateway, such as `172.18.0.1`, or the host's LAN address) and port `40009`. The relay uses only that one UDP port, so it does not get in the way of anything else on the host.

## Requirements

Nextcloud 30–34 and PHP 8.1 or newer. **Nothing else is required**: device discovery, naming, vendor lookup, DNS, whois, subnet maths, the live throughput graph and the DNS resolver comparison all work on a stock PHP install.

Everything below is optional. Each entry buys one capability, and NetBase degrades to a documented fallback without it.

You do not have to read this table to find out where you stand. **System information**, at the bottom of the app's sidebar, shows this server's basics, the tools that work right now, and the ones that would start working if something were installed — with the install command for the package manager this machine actually has. Administrators see the same list, plus the commands, in **Administration settings → NetBase**; ordinary users see which capabilities are dormant without the system details.

| Component | Enables | Without it |
|---|---|---|
| `ext-sockets` (PHP) | Multicast discovery (WS-Discovery, SSDP) and Wake-on-LAN | Devices are still found and named over NetBIOS, mDNS and reverse DNS |
| `ext-curl` (PHP) | Internet speed test, HTTP timing breakdown | Those two features are unavailable; nothing else changes |
| `ext-ftp` (PHP) | Browsing FTP servers and moving files | SFTP and SCP still work — they use the library NetBase carries with it |
| `chromium` | **Show the page**: a device's web page rendered on the server as a picture | The web ports are still offered as links |
| `iperf3` | LAN throughput measurement | Local link speed cannot be measured |
| `ss` (iproute2) | The listening-sockets list | Falls back to `netstat` |

One component wants more than an install:

- **iperf3** — the far end has to be listening: `iperf3 -s`

## Notes for administrators

**Access.** NetBase is an administrator's app that can lend out its harmless half. Every tool has its own access level, set in **Administration settings → NetBase**: administrators only, administrators plus named groups, or every signed-in user. Administrators always have everything. The lookups that touch nothing locally — DNS, whois, TLS and HTTP, subnet maths, a clock check, an SSH or Telnet probe — default to every signed-in user, because none of them is more powerful than a public web form. Everything that touches the local network defaults to administrators: sweeping it, Wake-on-LAN, the server view, mail tests, FTP and SFTP, SSH commands, and the device windows. So does reading the device list, which is not a lookup but the inventory of a private network — what is on it, what it answers on, what it is called. Running a sweep is a separate permission from reading its result, because a sweep puts thousands of ARP probes on the wire. Where nothing at all is permitted, NetBase leaves itself out of the app menu rather than advertising a door that will not open.

When a user is allowed no tool at all, NetBase leaves itself out of that user's app menu and its page answers 403. That behaviour is a setting, so an instance can advertise the app to everyone if it prefers.

**Neighbour table.** A sweep creates one kernel neighbour entry per probed address. If the target is larger than `net.ipv4.neigh.default.gc_thresh3` (1024 on most systems), the kernel forces garbage collection and logs `neighbour table overflow`. The scan is still correct, but NetBase shows the exact `sysctl` command to raise the limit before you sweep anything larger than that.

**Safety.** External binaries are never invoked through a shell: arguments are passed as an array, never as a command line a shell could reinterpret.

## Command line

```
occ netbase:scan [-t 192.168.1.0/24] [--gentle] [--arp-only] [--no-ports] [--json]
occ netbase:devices [--online] [--json]
```

## Licence

AGPL-3.0-or-later. The bundled vendor database is derived from the public IEEE registries (see `data/oui.source`).

---

# NetBase（日本語）

NetBase は、Nextcloud をネットワーク管理コンソールとして使えるようにするアプリです。LAN 上の機器をすべて検出して種類を判別し、各機器の設定画面を Nextcloud の中から開けます。日常的に使う調査ツールも同じ画面にまとめています。

## 各機能の仕組みと用途

### 機器ウィンドウ（機器の設定画面）

**仕組み** ― サーバーが機器のページを取得し、ページ内のアドレスをすべて書き換えます。リンク、スタイルシート、スクリプト、フォーム、リダイレクト、meta refresh に加え、ページのスクリプトが実行中に組み立てるアドレスも対象です。これにより、機器の画面全体が、機器のアドレスではなく Nextcloud のアドレスで表示されます。ウィンドウごとに、対象のアドレス・ユーザー・有効期限を記した署名付きのチケットを発行します。機器とのセッションはサーバー側で保持するため、ページを移動してもログイン状態が保たれます。開けるのは、プライベートアドレス、このサーバー自身のアドレス、スキャンで実際に見つかったホストだけです。表示中のページは、ポリシーによってプロキシ自身のパスに固定され、サンドボックスにより自分自身以外のページへは移動できません。

**用途** ― 離れた場所にある拠点のルーターの設定変更、プリンターのトナー残量やトレイ設定の確認、新しいファームウェアの送信や保存済み設定の復元に使えます。VPN や踏み台サーバーを用意しなくても、現地に出向かなくても、お客様の機器をサポートできます。ウィンドウは同時に複数開いて移動やサイズ変更ができ、それぞれが表示していたページを覚えています。

**ページが正しく動かないとき** ― 機器によっては、ウィンドウの中で画面が真っ白になったり、押しても反応しなかったりします。ウィンドウ右上の **「診断」** を押すと、ページを最初から読み込み直し、**「終了」** を押すまでの動きを記録します。記録するのは、サーバーが中継したリクエストとその応答、NetBase がブラウザーに渡さなかった機器のヘッダー、画面で起きたエラー・クリック・フォームの送信です。パスワード、画面に入力した内容、画面の文章は記録せず、アドレスの「?」より後ろの値も伏せるため、結果をそのまま不具合の報告に貼り付けられます。

### 機器の検出と機器台帳

**仕組み** ― Nextcloud は特権なしで動作するため、raw ソケットは使えず、PHP から ARP スキャンを行うこともできません。そこで NetBase は、カーネルの仕組みを利用します。同じリンク上のアドレスへデータグラムを送ると、カーネルは必ずそのアドレスを解決し、その結果は誰でも読める近隣テーブル（ARP テーブル）に記録されます。機器の名前は NetBIOS・mDNS・WS-Discovery・SSDP（いずれも通常の UDP）で機器自身に問い合わせ、ベンダーは同梱の IEEE レジストリ（53,000 件を超えるプレフィックス）から判別します。そのため、MAC アドレスを外部に送信することはありません。開いているポートの確認は、5 段階の深さから選べます。スキャンを短時間で終えられる主要な 15 ポートから、65,535 ポートすべてまでです。さらに NetBase は、機器がマルチキャストグループに送るアナウンスを、バックグラウンドで常に受信しています。アナウンスは同じケーブル上であればそのまま届くため、同じケーブルにつながった別サブネットの機器（工場出荷時のアドレスのままのカメラなど）も、ルーティングできず問い合わせに応答できない状態でも見つかります。NetBase が動いているサーバー自身も一覧に記録します。マシンは自分のアドレスをネットワークに問い合わせないため、自分の近隣テーブルには載らないからです。スキャンも、1 台の機器のポートスキャンも、対象はローカルネットワーク（プライベートアドレスの範囲か、このサーバーが接続しているネットワーク）に限られ、グローバルアドレスの範囲は拒否します。

**用途** ― これまで整っていなかった拠点の機器台帳づくり、誰が設置したか分からない機器の発見、IP アドレスを割り当てる前の空き確認に使えます。一覧はまとめて CSV でエクスポートできるので、Nextcloud の外で管理している資産台帳にも取り込めます。電源を切った機器の情報が、近隣テーブルにしばらく残ることがあります。管理者が任意でヘルパーを導入すると（sudoers に 1 行追加するだけです。スクリプトの内容はアプリに表示され、導入するかどうかは完全に任意です）、NetBase が近隣テーブルを消去できるようになり、更新時には今動いている機器だけが表示されます。

### DNS 調査

**仕組み** ― DNS の問い合わせパケットを NetBase が直接組み立てるため、PHP 標準の名前解決では取得できない TLSA・DS・DNSKEY・SSHFP・CAA・SVCB などのレコードも、応答のフラグを含めて取得できます。同じ問い合わせを複数の DNS サーバーに同時に送ったり、ルートサーバーから順にたどったり、ゾーン転送として要求したりすることもできます。

**用途** ― 移行作業がどこまで反映されたかの確認、拠点によって名前解決の結果が異なる原因の調査、自社のネームサーバーがゾーン全体を第三者に渡していないかの確認に使えます。

### whois・空きドメイン検索

**仕組み** ― まず IANA に問い合わせ、そこで示されたレジストリ、さらにそこで示されたレジストラへと、紹介先を最後までたどります。通信はソケットで直接行うため、`whois` コマンドは必要ありません。

**空きドメイン検索** ― 「.com」などの末尾を付けずに名前を入力すると、多数のトップレベルドメインについて一度に調べます。範囲は、主要なもの（48 種）、全 gTLD、全 ccTLD、すべて（約 1,180 種）から選べます。確認は DNS の委任、RDAP、WHOIS の順に行い、それぞれを空き（○）、使用中（×）、空きの可能性（△）、判定不能（?）で表示します。使用中のものには Whois ボタンがあり、登録情報を開けます。判定不能は、レジストリが問い合わせの回数を制限したり、問い合わせを拒否したりした場合です。使用中と判定不能の結果は、それぞれスイッチで非表示にできます。画面が広い場合は結果を 2〜3 列で表示し、一覧全体をコピー・ダウンロード・保存できます。

**用途** ― ドメインの有効期限を、切れて慌てる前に把握できます。問題を起こしているアドレスについて、連絡先を調べられます。移管の前には、ドメインが実際にどのレジストラで管理されているかを確認できます。レジストラのサイトを使わずに、まだ空いているドメイン名を探すこともできます。

### TLS・HTTP 検査

**仕組み** ― 実際に確立した通信から、証明書、証明書チェーン、有効期限を読み取ります。TLS のバージョンは 1 つずつ試して、まだ受け付けているものを調べます。リダイレクトの経路と応答ヘッダーも取得して評価します。

**用途** ― ブラウザーに警告される前に、証明書の期限切れに気付けます。監査で指摘される古い TLS バージョンを洗い出せます。リダイレクトが最終的にどこへ行き着くかも確認できます。

### サブネット計算・MAC アドレス照会

**仕組み** ― IPv4 と IPv6 のアドレス計算を行います。ネットワークを小さなネットワークに分割したり、ばらばらのアドレスを最少の CIDR ブロックにまとめたりできます。MAC アドレスの照会には、機器の検出と同じ同梱のレジストリを使います。

**用途** ― アドレス体系の見直しの計画、過不足のないファイアウォールルールの作成、ログに残った MAC アドレスからの機器の特定に使えます。

### ベンチマーク

**仕組み** ― インターフェースの統計はカーネルのカウンターを読み取り、差分をブラウザー側で計算します。LAN の計測には `iperf3` を使います。インターネットの計測では、公開されている計測サーバーまでの経路を測ります。DNS は複数のリゾルバの応答時間を並べて比較します。HTTP は 1 回のリクエストを、DNS・接続・TLS・待ち時間・転送に分けて計測します。

**用途** ― 「ネットワークが遅い」という感覚を数値で示せます。遅いのがスイッチのポートなのかインターネット回線なのかを見分けられます。機器やプロバイダーを変えたときの前後比較にも使えます。

### メール

**仕組み** ― SMTP・IMAP・POP3 はストリームソケットで直接やり取りするため、現在の PHP には同梱されなくなった `ext-imap` は必要なく、使用もしていません。DNS 側では MX・SPF・DKIM・DMARC・MTA-STS（ポリシーファイルの取得を含む）・TLS-RPT・BIMI・DANE を読み取り、各 MX のアドレスを 7 つの公開ブロックリストと照合します。

同じ画面で、保存済みのアカウントやその場で入力したアカウントのメールを読み書きできます。フォルダー、検索、既読・未読、フラグ、移動、削除のほか、新しいメールの作成、返信、転送もでき、Nextcloud のファイルを添付できます。

**用途** ― メールが届かない原因を調べられます。サーバー移行の前後の確認にも使えます。なりすまし対策のレコードが正しいこと、サーバーがオープンリレー（第三者中継）になっていないことを確認できます。管理しているサーバーのメールボックスを、メールソフトを設定せずに読んで返信することもできます。

### FTP・SFTP・SCP

**仕組み** ― SFTP と SCP には、NetBase に同梱している phpseclib 3 を使います（Nextcloud 本体に含まれるのは phpseclib 2 だけで、最近の形式の秘密鍵を読み込めないためです）。FTP には PHP 標準の拡張機能を使い、TLS の有無どちらにも対応します。転送はどちらの方向もファイルハンドルを通して少しずつ流すため、大きなファイルでも PHP のメモリに丸ごと読み込むことはありません。**保存済みの SSH 接続先は、そのままここで開けます。** 接続先のマシン・アカウント・鍵が同じなので、NetBase は SFTP で接続し、シェルは使えても SFTP サブシステムが無いサーバーには SCP で接続します。**ユーザーを変更する** を使うと、接続先の `sudo` を通して、root や www-data など別のアカウントとして操作できます（SCP で接続します）。切り替えるとそのアカウントのホームフォルダーを開き、やめると元のフォルダーに戻ります。パスワードはその場で入力を求め、その 1 回のリクエストにだけ使い、**どこにも保存しません**（設定にも RegiBase にもディスクにも残りません）。そのため、ページを再読み込みすると、再度入力を求めます。sudo にパスワードが要らないサーバーでは、ここでも入力は不要です。接続情報は RegiBase に、ご自身のマスターキーで暗号化して保存します。接続先をその場で入力して接続することもできます。

**用途** ― 機器やサーバーへの設定ファイルの配布、ログの回収に使えます。サーバー上での圧縮ファイルの展開や、文字コードを間違えて保存したファイルの修正にも使えます。手元のパソコンを経由せずに、リモートサーバーとご自身の Nextcloud のフォルダーとの間でファイルをやり取りできます。

### SSH・Telnet

**仕組み** ― 調査機能は、暗号化が始まる前にサーバーが提示する情報（識別文字列、対応アルゴリズムの一覧、ホスト鍵のフィンガープリント）を読み取るため、認証情報はまったく必要ありません。ログインして使う機能では、phpseclib でパスワードまたは秘密鍵を使って接続します。秘密鍵は直接入力するか、ご自身の Nextcloud のファイルから選べます。PHP はリクエストをまたいで接続を保持できないため、ターミナルはセッションをサーバー側で保持し、その内容をブラウザーへ逐次送ります。

**用途** ― ターミナルを開かずに、拠点サーバーのディスク容量、停止したサービス、未適用の更新を確認できます。本物のターミナルを開いて、`vi` でファイルを編集することもできます。SSH でまだ使えるアルゴリズムの点検や、Telnet ポートから何が見えるかの確認にも使えます。Telnet を開けたままにすることが何を意味するのかも、分かりやすく表示します。

### 時刻確認

**仕組み** ― NTP サーバーに UDP で時刻を問い合わせ、ずれを表示します。

**用途** ― 時刻のずれが原因かどうかを切り分けられます。証明書のエラーやログインの失敗の原因として最も多いのが、時刻のずれです。

### システム情報

**仕組み** ― このサーバーのインターフェース、アドレス、ルーティング、DNS リゾルバ、待ち受け中のソケットを表示します。あわせて、今使えるツールと、パッケージを追加すれば使えるようになるツールを一覧にし、このマシンで実際に使われているパッケージマネージャー用のインストールコマンドも表示します。

**用途** ― 今使っているサーバーの状態を把握できます。使えないままになっている機能を、ドキュメントを探し回らずに使えるようにできます。

### 結果の保存

**仕組み** ― どのツールの結果も、クリップボードへのコピー、テキストファイルとしてのダウンロード、ご自身の Nextcloud の **NetBase** フォルダーへの直接保存ができます。ファイル名にはツール名と日時が付き、以前のファイルを上書きすることはありません。機器一覧は CSV でもエクスポートできます。

**用途** ― 問い合わせチケットへの証拠の添付や、作業前後の記録の保管に使えます。状況を説明する代わりに、実際の出力をそのまま同僚に渡せます。

### AI アシスタント

**仕組み** ― NetBase のことを理解したチャットが、画面に表示されている内容（スキャン結果、ping、機器一覧など）を、ユーザーの言語で説明します。無料の **AI-Hub** アプリを通して動作し、AI サービス、API キー、利用制限は AI-Hub で一度設定すれば、サーバー上のすべてのアプリで使えます。アシスタント自身は何も実行しません。管理者が有効にすれば、コマンドを提案させることもできます。その場合も、コマンドが実行されるのは、ユーザーが `approve` と、そのコマンド用に表示されたコードを入力して承認したときだけです。AI-Hub がインストールされていなければ、この機能は表示されません。

**用途** ― 見慣れないスキャン結果やトレース結果、エラーを、検索しなくても読み解けます。
### アクセス権・表示・言語

**仕組み** ― NetBase は管理者向けのアプリです。ローカルネットワークに関わる機能（機器ウィンドウ、スキャン、Wake-on-LAN、メールのテスト、FTP、SFTP、SSH、機器一覧そのもの）は、初期設定では管理者だけが使えます。ただし、ツールごとに利用できる範囲を **管理者設定 → NetBase** で設定でき、管理者のみ、管理者と指定したグループ、ログインしている全ユーザーの 3 段階から選べます。初期設定で制限されているツールも含め、どのツールでも公開できます。使えるツールが 1 つもないユーザーには、使えないアプリを見せないよう、アプリメニューに NetBase を表示しません。テーマと言語はユーザーごとに設定でき、サイドバーの並び順も作業に合わせてドラッグで変更できます。

**用途** ― ネットワークへのアクセス権を渡さずに、ヘルプデスクの担当者に whois や DNS の調査だけを使ってもらえます。移行作業の間だけ機器一覧を特定のグループに公開し、作業が終わったら元に戻すこともできます。

## ベンチマーク

| 計測 | わかること | 必要なもの |
|---|---|---|
| **実効スループット（ライブ）** | インターフェースごとの受信・送信速度を、リアルタイムのグラフで表示。インターフェースのエラー数・破棄数も表示 | なし |
| **インターネット速度テスト** | ダウンロード・アップロードの速度（Mbps）と、接続の遅延・ジッター | `ext-curl` |
| **LANスループット** | ローカル回線の実際の速度を双方向で計測。1 秒ごとのグラフと再送回数も表示 | このサーバーともう 1 台のマシンの `iperf3` |
| **DNSリゾルバ比較** | 各リゾルバの中央値・平均・ジッター。このサーバーが使っているリゾルバも含めて比較し、最も速いものに印を付けます | なし |
| **時間の内訳** | 1 回の HTTP リクエストを、DNS・TCP・TLS・サーバーの処理時間・転送に分けて表示 | `ext-curl` |
| **保存済みの接続先への転送速度** | 保存済みの SFTP・SCP・FTP サーバーとの間で 1MB〜1TB のデータを送受信し、実際の速度を計測 | 保存済みの接続先 |

このうち 2 つについて補足します。

**実効スループット** は、カーネル自身のカウンター（`/proc/net/dev`）を読み取るだけなので、負荷がかからず、パケットキャプチャの権限も必要なく、通信を取りこぼすこともありません。差分はブラウザー側で計算するため、各サンプルにはタイムスタンプが付いています。

**インターネット速度テストは、LAN のテストではありません。** 計測するのはインターネット上の計測サーバーまでの経路で、計測先は [M-Lab](https://www.measurementlab.net/)（Google の速度テストでも使われている計測基盤）と [Cloudflare](https://speed.cloudflare.com/) から選べます。「最も近いところ（自動）」のままにすると M-Lab を使い、M-Lab にまったく接続できない場合だけ Cloudflare に切り替えます。2 つを用意しているのは、一方には接続できても、もう一方には接続できないネットワークがあるためです（M-Lab では外向きの WebSocket 通信が必要です）。また、同じ回線を独立した 2 つの方法で測れば、1 つだけの結果より信頼できるためでもあります。M-Lab で計測する場合は、近くの数台のサーバーに実際に接続し、最も速く応答したサーバーを選びます。これは M-Lab の一覧で先頭にあるサーバーとは限りません。遅延も同じサーバーに対して計測するため、速度と遅延は必ず同じサーバーの値になります。データの転送を始める前に、接続先のホスト名と所在都市を画面に表示します。LAN 内の速度を測るには、iperf3 のテストを使ってください。遅いのがスイッチのポートなのかインターネット回線なのかを正しく見分けられるのは、このテストだけです。**計測値はあくまで目安です。** 時間帯や、どのサーバーが応答したかによって変わります。

## メール

実際に必要になる順に、3 つの画面を用意しています。

**ドメイン設定** では、ドメイン名を入力すると、そのドメインのメールについて DNS で公開されている情報をすべて読み取ります。対象は、MX ホストとそのアドレス・逆引き名（受信側のサーバーも確認するため、正引きと逆引きの両方を確認します）、SPF の各設定項目と DNS 参照回数（上限の 10 回に対する回数）、DMARC のポリシーとレポートの送信先、DKIM の鍵とその長さ、MTA-STS（HTTPS でのポリシーファイルの取得を含む）、TLS-RPT、BIMI、DANE/TLSA レコード、メールクライアントの自動設定用の SRV レコード、そして各 MX アドレスが 7 つの公開ブロックリストに載っていないかです。最後に、問題のある点、確認したほうがよい点、問題のない点を、重要な順に分かりやすい言葉でまとめて表示します。

**サーバー検査** では、1 台のサーバーに実際に接続し、サーバーが提供している内容を表示します。表示するのは、グリーティング、対応機能の一覧、STARTTLS に対応しているかどうかと TLS に切り替えた後の証明書、実際に使われたプロトコルと暗号方式、認証方式です。ポート 25・587・465・993・143・995 は、プリセットからワンクリックで選べます。通信の全文も記録しており、必要なときに表示できます（認証情報は伏せて表示します）。その下には、追加の機能が 2 つあります。**オープンリレー検査**（外部の送信者と外部の宛先をサーバーに提示し、実際に送信する前に止めます）と、任意のアドレスの **ブロックリスト照会** です。

**メールの送受信** では、利用者が本当に知りたいことを確かめられ、基本的なメールソフトとしても使えます。保存済みの SMTP 接続先を選んで実際にテストメールを送信できます。保存済みの IMAP／POP3 アカウント、またはその場で入力したアカウントを選ぶと、フォルダーとメールの一覧を表示します。メールの検索と表示（HTML のメールは、スクリプトを動かさず、外部の画像も読み込まずに表示します。添付ファイルは Nextcloud のファイルに保存できます）、既読・未読の切り替え、フラグ、移動、削除（まずごみ箱へ移します）ができます。新しいメールの作成、返信、全員に返信、転送もでき、Cc、Bcc、Nextcloud のファイルの添付が使えます。送ったメールは「送信済み」に保存します。開いたメールは既読になります（設定で変えられます）。POP3 で読んだメールは、サーバー上では未読のまま残ります。

ここで使うプロトコルは、すべてストリームソケットで直接やり取りしています。`ext-imap` は必要なく、使用もしていません。現在の PHP には `ext-imap` が同梱されなくなったため、この点は重要です。

## SSH: 調査とコマンド実行

あえて 2 つの機能に分けています。

**調査には認証情報が必要ありません。** 暗号化が始まる前にサーバーが送る識別文字列と KEXINIT パケットから、対応アルゴリズムの完全な一覧が分かります。ホスト鍵のフィンガープリントは鍵交換で取得します。もう提供すべきでないもの（SHA-1 の鍵交換と MAC、CBC 方式の暗号、RC4、DSA、2048 ビット未満の RSA ホスト鍵、プロトコル 1）は、指摘事項として表示します。受け付けている認証方式の確認だけは、別のチェックボックスにしています。確認すると、相手のマシンのログにログイン失敗が 1 件記録されるためです。

**コマンド実行** では、保存済みの接続先にパスワードまたは秘密鍵でサインインし、コマンドを 1 つ実行して、出力と終了ステータスを返します。よく使う確認はプリセットにしてあります（システムの概要、ディスク使用量、失敗したサービスと最近のエラー、ネットワーク設定、待ち受け中のソケット、未適用の更新、ログイン中のユーザーとログインに失敗したユーザー）。その隣には、コマンドを自由に入力できる欄もあります。

**ターミナル** は本物のターミナルです。PHP-FPM はリクエストごとに処理を終えるため、セッションはページではなくサーバー側で保持します。ブラウザーは長時間つながったままのリクエストを 1 本開き、出力はそこを通って順に届きます。入力はそれとは別に送りますが、キー入力の順序が入れ替わらないよう、ひとまとまりずつ順番に送ります。接続先では本物の疑似端末を使うため、`top`・`vi`・`less` や対話式のパスワード入力もそのまま動き、色やカーソル移動も正しく表示されます。ウィンドウのサイズを変えると、ターミナルのサイズも変わります。ターミナルは、機器のポート 22、SSH の画面、接続できない機器に表示される案内から開けます。その案内には、その機器に接続するためのコマンドが、このサーバーで実行できる状態で用意されています。

**ターミナルの設定** は、TeraTerm の設定メニューを手本に「設定」→「端末」にまとめています。サーバーに伝える端末の種類（機器が別の種類を求めない限り xterm-256color）、Shift_JIS や EUC-JP などを使う古いサーバーや機器のための送受信の文字コード、OpenSSH の SendEnv と同じようにシェルと一緒に送る環境変数（サーバーが受け取るのは AcceptEnv で許した名前だけで、ふつうは LANG と LC_*）、通信の無い接続をルーターやファイアウォールが切らないための合図、Enter と Backspace で送る文字、スクロールバック、カーソルです。

**サインイン** では、ホスト、ポート、アカウントと、パスワードまたはご自身の Nextcloud にある秘密鍵ファイルを指定します。鍵を置いているフォルダーを設定画面で指定しておくと、ファイルの選択画面がそのフォルダーから開きます。

## ファイル: FTP・SFTP・SCP

保存済みの接続先を選ぶか、その場で入力すると、そのサーバーの中を閲覧できます。ディレクトリ、サイズ、更新日時、パーミッション、所有者を表示し、パス欄に直接入力して移動することもできます。左側がご自身の Nextcloud のファイル、右側がサーバーです。行を選んで **送信** か **受信** を押すか、反対側へドラッグすると転送します。そのほかの操作は、行を右クリックすると選べます。開く、ダウンロード、名前の変更、サーバー上でのコピーと移動、圧縮と展開、文字コードの変換、パーミッションの変更（フォルダーでは、中のファイルだけ・フォルダーだけにも当てはめられます）、所有者とグループの変更、日時を今にする、パスや URL のコピーです。

同じ名前のファイルがあるときは、どうするかを尋ねます。上書き、新しければ上書き、サイズが違えば上書き、続きから、両方残す、飛ばす、から選べ、そのファイルだけにするか、残りすべてに当てはめるかも選べます。中断した転送の再開、失敗した転送のやり直し、更新日時の保持、送信・受信それぞれの速度の上限にも対応しています。一覧の絞り込み（`*` と `?` が使えます）とサーバー内の検索、左右の比較、左右を連動させた移動（同期ブラウズ）、接続先ごとのブックマーク、キーボード操作（Del、F2、F5、Enter、Backspace、Ctrl+A、矢印キー）も使えます。

**圧縮と展開** には、サーバーに入っている道具（zip、tar、gzip、bzip2、xz、zstd、7-Zip、unrar）を使い、ZIP、tar、tar.gz、tar.bz2、tar.xz、tar.zst、7z、gz、bz2、xz、zst と、展開だけですが RAR に対応しています。サーバーで扱えない形式は、理由を添えて灰色で表示します。シェルが使えない接続先（FTP や SFTP 専用のアカウント）では、ZIP、tar、tar.gz、tar.bz2 を Nextcloud のサーバー側で作成・展開します。展開先は、指定しない限り新しいフォルダーです。その場に展開するときも、上書きを選ばない限り、すでにあるファイルはそのまま残します。

**文字コードの変換** では、今の文字コード（UTF-8、UTF-16、Shift_JIS、EUC-JP、ISO-2022-JP、GB18030、Big5、EUC-KR、Windows-1252、ISO-8859-1、Windows-1251、KOI8-R）を自動で判定し、文字コード・改行コード・BOM を変換します。変換先で表せない文字があるときは、書き込む前にその文字をお知らせします。結果は、上書きを選ばない限り別の名前で保存します。32MB までのファイルに対応しています。

転送はどちらの方向もファイルハンドルを通して少しずつ流すため、大きなファイルでも PHP のメモリに丸ごと読み込むことはありません。

FTP には PHP 標準の `ext-ftp` を使い、TLS の有無どちらにも対応します。SFTP と SCP には NetBase に同梱の phpseclib 3 を使うため、追加のインストールは必要ありません。どちらもパスワードと秘密鍵のどちらでもサインインできます（鍵の指定方法は **保存済みの接続先** を参照してください）。SCP は、SSH は使えても SFTP サブシステムが無いサーバー向けです。SCP にはディレクトリ一覧を取得する機能が無いため、NetBase がシェル経由で一覧を読み取り、SFTP とまったく同じ形で表示します。**保存済みの SSH 接続先も、そのままここで開けます。**

## Telnet と時刻確認

**Telnet** は、サーバーを「調べる」ツールではなく、サーバーを「操作する」ツールの側にあります。ウィンドウからサインインし、1 行送って応答を読み取ります。1 行ごとに接続し直すため、その合間に機器側で接続を開いたままにすることはありません。認証情報の要らない調査は、引き続き「調べる」側にあります。オプションのネゴシエーションに正しく応答してログイン画面を表示するので、たいていはそれだけでどの機器かが分かります。あわせて、Telnet が開いていることが何を意味するのかも表示します。

**時刻確認** は、NTP サーバーに時刻を問い合わせ、ずれを表示します。証明書のエラーやサインインの失敗の原因として最も多いのが時刻のずれで、この機能を使えば、その可能性をすぐに確かめられます。

## シェルのログ記録

シェルや SSH のウィンドウで入力した各行と、その結果として返ってきた内容を記録できます。**初期設定では記録しません。** ターミナルのログは人が作業した記録であり、残すかどうかは本人が決めることだからです。**設定 → 端末（シェルとSSH）** で有効にできます。

**1 ステップ** は、入力した 1 行と、その行に対する応答をひとまとめにしたものです。応答はその行で Return キーを押した**後**に返ってくるため、ステップが区切られるのは、そのステップ自身の Return ではなく、**次の** Return を押したときです。間違えやすく、テストの書き方も誤りやすい点です。記録する量は 2 つの上限で決まります。ウィンドウごとのステップ数（初期値は 5,000）と、保存日数です。日数はウィンドウの**最後の**ステップから数えるため、使用中のセッションが途中で削除されることはありません。日数を過ぎると、そのセッション全体を削除します。色、カーソル移動、ウィンドウタイトルは取り除き、テキストだけを残します。非常に長いステップは、前後を残して中ほどを省略します。

## 保存済みの接続先

メールとファイルのツールは、保存済みの接続先（種類、ホスト、ポート、暗号化方式、ユーザー名、認証情報）を使って動作します。接続先は、作成したアカウントだけのものです。共有の接続先はありません。保存したパスワードはその人個人の認証情報であり、このサーバー全体のものではないためです。

**秘密鍵の指定方法** ― **認証方式** で **秘密鍵** を選びます（SSH と SFTP の接続先で選べます）。指定方法は 2 つあります。1 つは、ご自身の Nextcloud 内にある鍵ファイルのパスを入力する方法です（例: `Keys/id_ed25519`。`.pub` が付いていない方のファイル）。この場合は保存時にサーバーがファイルを読み込むため、鍵がブラウザーを経由することはありません。もう 1 つは、その下の欄に鍵の内容を貼り付ける方法です。鍵にパスフレーズがある場合は、ユーザー名の隣の欄に入力してください。OpenSSH 形式と PEM 形式のどちらにも対応しています。

接続先の種類（SSH、SCP、FTP/SFTP、メール）ごとに、保存先のコレクションと項目の割り当てを個別に指定できます。画面の一覧もこの区分に従います。SCP を選ぶと SCP の一覧、FTP と SFTP では共通の一覧、SSH では SSH の一覧が表示されるため、あるプロトコル用に保存したサーバーが、そのプロトコルに対応していない別の機能の候補に出ることはありません。SCP は SSH の認証情報をそのまま使いますが、FTP は通常、別のマシンの別のアカウントなので、同じ一覧からは読み込みません。複数の種類に同じコレクションを指定しても問題ありません（SSH と SCP は通常、同じ一覧です）。専用のコレクションを指定していない種類は、全体用に選んだコレクションを使います。そのため、あえて分けるまでは何も変わりません。

パスワード（または秘密鍵とそのパスフレーズ）は RegiBase に保存し、**ご自身のマスターキー** で暗号化します。このサーバーが持つ鍵で暗号化するのではないため、データベースを読める人でも、このサーバー自身でも、中身を開くことはできません。マスターキーは接続を最初に使うときに入力を求め、**そのブラウザーのセッションの間だけ** 保持し、設定にもディスクにも保存しません。認証情報が **ブラウザーに送り返されることはありません。** 画面に伝わるのは、保存されているかどうかだけです。パスワードを入力し直さずに接続先を保存し直した場合は、保存済みのパスワードがそのまま使われます。画面に表示する通信のやり取りでは、認証情報の行を伏せて表示します。

## Wake-on-LAN

電源の切れた機器は何も応答しません。そのため、起動するには、その機器の MAC アドレスと、同じ LAN で動いていてマジックパケットを送れる機械の 2 つが必要です。NetBase は、スキャンで一度でも見えた機器の MAC アドレスを覚えています。電源が切れている、ルーターの向こうにある、コンテナの中から見ているなどの理由で一度も見えていない機器は、機器の詳細か、アドレスで追加するときに MAC アドレスを入力してください。電源の切れている機器も追加でき、そのまますぐ起動できます。

パケットの送り方は **管理者設定 → NetBase → Wake-on-LAN** で選びます。

- **このサーバーから、指定したアドレスとポートへパケットを送る** ― ふつうの放送は `255.255.255.255` のポート 9 で、Nextcloud が LAN の上で動いていればこれで届きます。サーバーが別のネットワークカードでつながっている LAN には、その網の放送アドレス（`192.168.1.255` など）を使います。
- **このサーバーでコマンドやスクリプトを実行する** ― `{mac}`・`{MAC}`・`{ip}` が置き換わります。たとえば、ルーターや Home Assistant の起動用アドレスを `curl` で呼び出せます。
- **常に動いている機械で、保存済みの SSH 接続を使ってコマンドを実行する** ― `wakeonlan` や `ether-wake` が入った、同じ LAN の NAS や小さなサーバーで実行します。接続先は起動する人が選びます。その人には「SSHコマンド」の権限も必要です。

コマンドに差し込まれるのは、形を確かめた MAC アドレスと IPv4 アドレスだけです。

**コンテナで動かしている場合（AIO・Docker・Podman）** ― ブリッジ接続のコンテナからは、LAN に放送を出せません。パケットはブリッジで止まり、ホストまでしか届かないためです。このアプリの `resources/wol-relay.py` は、ホストで動かす小さな中継役です。1 つの UDP ポート（既定は 40009）でマジックパケットを受け取り、LAN への放送として送り直します。それ以外は何も通さず、Python の標準ライブラリだけで動きます。ホストのネットワークで動かしてください。たとえば次のとおりです。

```
docker run -d --name netbase-wol-relay --network host --restart unless-stopped \
  -v /path/to/wol-relay.py:/wol-relay.py:ro python:3-alpine python3 /wol-relay.py
```

そのうえで 1 つ目の送り方を選び、コンテナから見たホストのアドレス（ブリッジのゲートウェイ、たとえば `172.18.0.1`、またはホストの LAN のアドレス）とポート `40009` を入れてください。中継役が使うのはこの UDP ポート 1 つだけなので、ホストのほかのサービスとはぶつかりません。

## 動作要件

Nextcloud 30〜34、PHP 8.1 以降が必要です。**それ以外には何も必要ありません。** 機器の検出、名前の取得、ベンダーの判別、DNS、whois、サブネット計算、実効スループットのグラフ、DNS リゾルバ比較は、どれも標準構成の PHP でそのまま動作します。

以下はすべて任意です。それぞれ 1 つの機能を追加するもので、無い場合は、表に記載した代わりの動作になります。

この表を読まなくても、今の状態は確認できます。アプリのサイドバーの一番下にある **システム情報** に、このサーバーの基本情報、今使えるツール、何かをインストールすれば使えるようになるツールが、このマシンで実際に使われているパッケージマネージャー用のインストールコマンド付きで表示されます。管理者は **管理者設定 → NetBase** でも、同じ一覧とコマンドを確認できます。一般のユーザーには、システムの詳細は表示されず、どの機能が使えない状態かだけが表示されます。

| コンポーネント | 追加される機能 | 無い場合 |
|---|---|---|
| `ext-sockets`（PHP） | マルチキャストでの検出（WS-Discovery・SSDP）と Wake-on-LAN | NetBIOS・mDNS・逆引き DNS による機器の検出と名前の取得は、引き続き使えます |
| `ext-curl`（PHP） | インターネット速度テスト、HTTP の時間の内訳 | この 2 つの機能だけが使えなくなり、ほかには影響しません |
| `ext-ftp`（PHP） | FTP サーバーの閲覧とファイルのやり取り | SFTP と SCP は、NetBase に同梱のライブラリで引き続き使えます |
| `chromium` | **ページを表示** ― 機器の Web ページをサーバー上で描画し、画像として表示 | Web のポートは、リンクとして引き続き表示されます |
| `iperf3` | LAN スループットの計測 | ローカル回線の速度は計測できません |
| `ss`（iproute2） | 待ち受け中のソケットの一覧 | 代わりに `netstat` を使います |

インストールするだけでは使えないものが 1 つあります。

- **iperf3** ― 相手側のマシンで待ち受けを起動しておく必要があります：`iperf3 -s`

## 管理者向けの情報

**アクセス権** ― NetBase は管理者向けのアプリですが、危険のない機能はほかのユーザーにも使ってもらえます。ツールごとに利用できる範囲を **管理者設定 → NetBase** で設定でき、管理者のみ、管理者と指定したグループ、ログインしている全ユーザーの 3 段階から選べます。管理者は常にすべてのツールを使えます。ローカルの環境に何も触れない調査（DNS、whois、TLS と HTTP、サブネット計算、時刻確認、SSH や Telnet の調査）は、公開されている Web のフォーム以上のことはできないため、初期設定でログインしている全ユーザーが使えます。ローカルネットワークに関わる機能（ネットワークのスキャン、Wake-on-LAN、サーバー情報、メールのテスト、FTP と SFTP、SSH のコマンド実行、機器ウィンドウ）は、初期設定では管理者だけが使えます。機器一覧の閲覧も同じです。機器一覧は単なる調査結果ではなく、プライベートネットワークの台帳（何がつながっていて、どのポートで応答し、何という名前か）だからです。スキャンの実行は、結果の閲覧とは別の権限です。1 回のスキャンで、数千件の ARP の問い合わせをネットワークに送るためです。何も許可されていないユーザーには、使えないアプリを見せないよう、アプリメニューに NetBase を表示しません。

使えるツールが 1 つもないユーザーには、アプリメニューに NetBase を表示せず、ページを開いても 403 を返します。この動作は設定で変更できるため、すべてのユーザーにアプリを表示することもできます。

**近隣テーブル** ― スキャンでは、問い合わせたアドレスごとに、カーネルの近隣テーブルに 1 件ずつエントリが作られます。対象のアドレス数が `net.ipv4.neigh.default.gc_thresh3`（多くのシステムでは 1024）を超えると、カーネルが強制的にガベージコレクションを行い、`neighbour table overflow` をログに記録します。スキャン結果そのものは正しく得られますが、これより大きい範囲をスキャンする前に上限を引き上げられるよう、NetBase は実行すべき `sysctl` コマンドを表示します。

**安全性** ― 外部のコマンドをシェル経由で実行することはありません。引数は配列として渡し、シェルが別の意味に解釈できるコマンド行にはしません。

## コマンドライン

```
occ netbase:scan [-t 192.168.1.0/24] [--gentle] [--arp-only] [--no-ports] [--json]
occ netbase:devices [--online] [--json]
```

## ライセンス

AGPL-3.0-or-later。同梱のベンダーデータベースは、公開されている IEEE のレジストリをもとに作成しています（`data/oui.source` を参照）。
