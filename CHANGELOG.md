# Changelog

All notable changes to NetBase are documented here.

## 0.2.0 — 2026-08-23

### Added
- **Device windows**: a web port in the device list opens that device's own interface in a window inside NetBase, fetched through the server. A link to a local address is useless from anywhere else; this is not a link but the page itself, delivered by the server that can reach it. Several windows can be open at once, and each can be moved, resized, reloaded or made to fill the screen.
  - The window is authorised by a signed ticket that names the address, the person and an expiry, so the page needs no access to Nextcloud to be shown — and, kept at arm's length like that, cannot act as the signed-in user.
  - Only addresses on this server's own networks, or hosts a scan has actually seen, can be opened. NetBase is a network tool, not an open proxy.
  - Addresses inside the page — links, stylesheets, scripts, forms, redirects, meta refreshes and the ones its own scripts build while it runs — are pointed back through the server, and the page's character set is preserved, so Japanese device interfaces read correctly.
  - A device interface built out of frames works like the device means it to: its menu fills the frame it names, `<base target>` included, and its "replace everything" links fill the window. A sandboxed page may navigate only itself, so the window's own document does the navigating on behalf of whichever frame asked.
  - A line under the window's title says whose settings page this is and that it works from anywhere — written for whoever opens the window, not for whoever built it.
  - Files can be sent to a device through the window — new firmware, a saved configuration — which is one of the things people open a device's page for.
  - The page can reach nothing but the proxy: its scripts, styles, images, forms and requests are pinned by policy to NetBase's own proxy path, so a device page cannot call a Nextcloud endpoint even when shown in full. It also stays sandboxed against navigating anything but itself — a device that tries to break out of frames cannot take the browser with it — and its own "replace everything" links fill the window instead.
  - The device's session is kept: a sign-in cookie without an expiry is never written to a cookie file, which is exactly what a router or a printer sets, so it is stored deliberately for that person and that device. Without it the device asked for a password again on the next page.
  - A device that asks for a user name and password is answered inside the window: a browser will not show its own sign-in box in a window kept away from Nextcloud, so NetBase asks instead and keeps the answer encrypted, for that person and that device alone. When the device stops accepting it, it is dropped and asked for again.
  - The window has a back button, a front-page button and an address line that follows the page, keeping its own trail — a page held at arm's length cannot be asked where it has been.
  - Links a device aims at the whole browser (`_top`, `_parent`, `_blank`) are turned back on the window, in the markup and in whatever its scripts set later, so nothing walks out of NetBase.
- A test rig under `tests/testrig` serves everything that makes a real device interface awkward — EUC-JP without a charset header, root-relative assets, escaping targets, a redirecting login with a cookie, a frameset, `document.write`, XHR and HTTP authentication — so the windows can be checked against it.
- The tools in the sidebar can be dragged into whatever order you work in, and the order is kept for your account. Alt with the up and down arrows does the same without a mouse, and **Settings** puts the list back the way it shipped. A tool added later, or one you are granted later, appears at the end rather than disappearing.
- The sidebar's appearance and language dialog is now simply **Settings**.

### Changed
- The device list now defaults to administrators. It is not a lookup like whois or ping but the inventory of a private network — what is on it, what it answers on, what it is called — and that belongs to whoever runs the network. Every instance can still hand it to a group, or to everyone, in the app's admin settings.
- A web port is shown as a link only to an account that may open a device window; to anyone else it is plain text rather than a link that can only be refused.

## 0.1.0 — 2026-08-22

First working version.

### Added
- Privilege-free LAN discovery: neighbour-table priming and read-back, with per-device names from NetBIOS, mDNS, WS-Discovery, SSDP and reverse DNS
- Bundled IEEE MA-L / MA-M / MA-S vendor database (53,694 prefixes) with binary-search lookup and randomised-MAC detection
- Device type classification from open ports, vendor and reported names
- Device inventory with rename, type, tags, notes, first/last seen and CSV export
- Chunked scanning with live progress, so a /16 never blocks a single request
- Sweep slices and send rate sized from the kernel neighbour table and from what Wi-Fi can carry: on a /16 with ten devices, 20,000 packets/s found six of them and 1,500/s found all ten
- Neighbour-table headroom detection, with the exact sysctl command to raise it
- Tools: DNS (with SPF/DMARC), whois with IANA referral following, ping, traceroute, TCP port check with banners, TLS certificate and HTTP header inspection, subnet calculator, MAC vendor lookup, Wake-on-LAN, server network information
- Benchmarks: live per-interface throughput from the kernel counters, internet speed test with latency and jitter, LAN throughput over iperf3, a DNS resolver comparison that includes this server's own resolver, an HTTP timing breakdown and per-hop path quality over mtr
- A System information dialog in the app sidebar: this server's basics, the tools that work now, and the ones an install would unlock — with the command for this machine's package manager. Ordinary users see which capabilities are dormant, without the system details or the commands
- Mail server testing: a domain policy audit (MX with forward-confirmed reverse DNS, SPF with its DNS-lookup budget, DMARC, DKIM key sizes, MTA-STS including the policy file, TLS-RPT, BIMI, DANE/TLSA, autoconfiguration SRV records and seven public blocklists), a server test for SMTP/IMAP/POP3 with STARTTLS and certificate details, an open-relay test that stops before anything is sent, a real test message through a saved SMTP account, and a mailbox check over IMAP or POP3 — all spoken directly over stream sockets, with no ext-imap
- Open ports in the device list are links: web ports open the device's own page, and FTP, SSH and mail ports open the matching NetBase tool with the address filled in
- Show the page: with a headless Chromium installed, a device's web page is rendered on the server and shown as a picture, which also works for pages only the server can reach
- FTP and SFTP can be used without saving anything first — type the details, connect, and save to the list afterwards if you want it again
- An SSH console window: each line reconnects and carries the working directory across, so cd, ls and tail behave as expected, with command history on the arrow keys. Programs that need a real terminal cannot run there, and the window says so
- The clock check moved out of the SSH tab into one of its own, and "This server" moved into System information, which is now shown to administrators only
- SSH commands: sign in to a saved connection with a password or a private key and run a command, with presets for a system snapshot, disk usage, failed services, network configuration, listening sockets, pending updates and sign-in history
- DNS in depth: any record type (TLSA, DS, DNSKEY, SSHFP, CAA, SVCB and the rest) asked of any resolver with the reply's flags, a side-by-side comparison across the large public resolvers, a delegation trace from the root servers, and a zone-transfer test — all spoken as raw DNS rather than through PHP's resolver functions
- TLS version matrix: which of TLS 1.0 to 1.3 a server still accepts, with findings; security-header assessment on the HTTP inspector
- TCP ping for hosts that drop ICMP, and path-MTU discovery
- Subnet splitting into equal networks and aggregation of scattered addresses into the fewest CIDR blocks; port checks accept ranges and presets
- FTP and SFTP: browse a remote server and stream files both ways between it and your own Nextcloud files, with folder create/rename/delete. FTP through ext-ftp, SFTP through the phpseclib Nextcloud already ships, signing in with a password or a private key
- Saved connections, per account: the credential is encrypted with ICrypto, decrypted only for one connection, never sent back to the browser, and masked in the protocol transcripts
- SSH and Telnet probes: identification string, complete algorithm list from the KEXINIT packet, host key fingerprints, optional sign-in-method discovery, and warnings for SHA-1, CBC, RC4, DSA and undersized RSA host keys
- Clock check over NTP, reporting this server's offset against a time server
- Twenty languages: English, Japanese, German, Spanish, French, Italian, Portuguese, Russian, Chinese, Korean, Arabic, Hindi, Turkish, Indonesian, Vietnamese, Thai, Persian, Polish, Ukrainian and Czech — 677 strings each, including every finding the server writes. The language can be chosen inside NetBase, independently of Nextcloud's, and switches without reloading the page
- A per-user Theme dialog in the app sidebar: follow Nextcloud, or pin NetBase to light or dark for that account. The choice is stored on the account and painted server-side, so a reload never flashes the wrong colours
- An optional-components panel in the administration settings: every component with its state, what it enables, what happens without it, and the install command for the package manager this server actually has
- nmap front end with presets, XML result parsing and a strict argument allow-list
- Per-tool access control in Nextcloud's administration settings: each tool is set to administrators only, administrators plus named groups, or every signed-in user. Reading the device list is a separate permission from running a sweep, so the list and ping can be open to everyone while scanning stays with administrators
- The app menu entry is hidden — and the page answers 403 — for users allowed no tool at all, which is itself a setting
- occ commands `netbase:scan` and `netbase:devices`
- The NetBase mark, converted from the supplied artwork to outlines so it renders identically without the Rubik font installed: `img/app.svg` (white, for the app menu) and `img/logo.svg` (full colour, used in the sidebar and on the loading screen), cropped to the artwork and sized by height so it fills its space
- English and Japanese translations
