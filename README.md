# NetBase

Network toolbox for Nextcloud — fast LAN device discovery with vendor lookup, plus DNS, whois, TLS, mail, file-transfer and benchmark tools.

NetBase turns your Nextcloud into a network console. It finds every device on your LAN, tells you what each one is, opens each one's own settings page from inside Nextcloud, and keeps the everyday lookup tools on the same screen.

## What each part is built on, and what it is for

### Device windows

**How it works.** The server fetches the device's own page and rewrites every address inside it — links, stylesheets, scripts, forms, redirects, meta refreshes, and the ones the page's scripts build while it runs — so the whole interface arrives on Nextcloud's address instead of the device's. Each window carries a signed ticket naming the address, the person and an expiry, and the device's session is held on the server, so signing in survives from page to page. Only addresses on this server's own networks, or hosts a scan has actually seen, can be opened; the page is pinned by policy to the proxy's own path, and sandboxed against navigating anything but itself.

**What it is for.** Changing a branch router's settings from somewhere else entirely. Reading a printer's toner levels and its tray configuration. Sending new firmware or restoring a saved configuration. Supporting a customer's equipment without a VPN, a jump host or a site visit. Several windows can be open at once, moved and resized, each remembering where it has been.

### Device discovery and inventory

**How it works.** Nextcloud runs unprivileged, so raw sockets — and therefore ARP scanning in PHP — are not available. NetBase makes the kernel do the work instead: sending a datagram to an on-link address forces the kernel to resolve it, and the result lands in the neighbour table, which is world readable. Names come from the devices themselves over NetBIOS, mDNS, WS-Discovery and SSDP, all plain UDP, and vendors from the bundled IEEE registries — more than 53,000 prefixes, so no MAC address is ever sent anywhere.

**What it is for.** Building the asset list a site never quite had. Finding the device nobody remembers installing. Seeing which addresses are free before assigning one. Exporting the lot as CSV for an inventory that lives outside Nextcloud.

### DNS

**How it works.** Queries are built as raw DNS packets, so record types PHP's own resolver cannot return — TLSA, DS, DNSKEY, SSHFP, CAA, SVCB — come back with the reply's flags intact. The same question can be put to several resolvers at once, traced down from the root servers, or asked as a zone transfer.

**What it is for.** Watching a migration take effect. Explaining why one office resolves a name differently from another. Checking that your name servers do not hand the whole zone to strangers.

### Whois

**How it works.** IANA is asked first, then the registry it names, then the registrar it names — the referral chain followed to the end, over plain sockets. No `whois` binary is required.

**What it is for.** Expiry dates before they surprise you. Who to contact about an address that is causing trouble. Which registrar a domain actually sits at, before a transfer.

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

**What it is for.** Working out why mail is not arriving. Checking a migration before and after. Proving the anti-spoofing records are right, and that the server is not an open relay.

### FTP and SFTP

**How it works.** SFTP uses the phpseclib copy Nextcloud already ships for its external storages; FTP uses PHP's own extension, with or without TLS. Transfers stream through a file handle in both directions, so a large file never lands in PHP's memory. Connection details are encrypted with Nextcloud's `ICrypto`, and a connection can also be typed in on the spot.

**What it is for.** Pushing a configuration file to a device or a server. Collecting logs. Moving files between a remote server and your own Nextcloud folders without a laptop in the middle.

### SSH and Telnet

**How it works.** The probe reads what a server offers before anything is encrypted — its identification string, its algorithm list, its host key fingerprint — so it needs no credentials at all. The signed-in half uses phpseclib with a password or a private key. PHP cannot hold a session open between requests, so the console reconnects for each line and carries the working directory across.

**What it is for.** Checking a branch server's disk, failed services and pending updates without opening a terminal. Auditing which SSH algorithms are still offered. Seeing what a Telnet port exposes — and being told plainly what leaving it open means.

### Clock check

**How it works.** An NTP server is asked for the time over UDP and the offset is reported.

**What it is for.** Ruling the clock in or out. A drifted clock is behind more certificate and sign-in failures than anything else.

### System information

**How it works.** This server's interfaces, addresses, routes, resolvers and listening sockets, alongside a list of which tools work right now and which would start working if a package were installed — with the install command for the package manager this machine actually has.

**What it is for.** Knowing what you are standing on. Getting a dormant capability working without hunting through documentation.

### Keeping what you found

**How it works.** Every tool's findings can be copied to the clipboard, downloaded as a text file, or written straight into a **NetBase** folder in your own Nextcloud files — named by tool and timestamp, and never over the top of an earlier one. The device list also exports as CSV.

**What it is for.** Attaching the evidence to a ticket. Keeping a before-and-after pair around a change. Handing a colleague the exact output rather than a description of it.

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

Two of these deserve a note.

**Live throughput** is read from the kernel's own counters in `/proc/net/dev`, so it costs nothing, needs no capture privileges and cannot miss traffic. It is differentiated in the browser, which is why a timestamp travels with each sample.

**The internet speed test is not a LAN test.** It measures the path to a public endpoint — by default Cloudflare's, and the interface names the host before anything is transferred. To measure the local link, use the iperf3 test: it is the only honest way to tell a slow switch port from a slow internet connection. The endpoint can be changed with `occ config:app:set netbase speedtest_down --value=...` (and `speedtest_up`).

## Mail

Three views, in the order you actually need them.

**Domain policy** takes a domain name and reads everything DNS publishes about its mail: the MX hosts with their addresses and reverse names (checked both ways, because receivers do), SPF with its terms and its DNS-lookup count against the limit of ten, DMARC with its policy and reporting address, DKIM keys with their size, MTA-STS (including fetching the policy file over HTTPS), TLS-RPT, BIMI, DANE/TLSA records, the client autoconfiguration SRV records, and each MX address against seven public blocklists. It ends with a ranked list of findings in plain language — what is broken, what is worth looking at, what is fine.

**Server test** talks to one server and reports what it offers: the greeting, the capability list, whether STARTTLS is there and what the certificate looks like once it is, the negotiated protocol and cipher, and the sign-in mechanisms. One-click presets cover ports 25, 587, 465, 993, 143 and 995. The full conversation is kept and shown on request, with credentials masked. Two extras sit under it: an **open-relay test** — a foreign sender and a foreign recipient offered to the server, stopping before anything is sent — and a **blocklist lookup** for any address.

**Send and receive** proves the thing people actually care about. Pick a saved SMTP connection and send a real test message; pick a saved IMAP or POP3 account and sign in to see the message and unread counts and the folder list.

Every protocol here is spoken directly over a stream socket. `ext-imap` is neither needed nor used, which matters because it no longer ships with current PHP.

## SSH: probe and command

Two halves, deliberately separate.

**The probe needs no credentials.** The identification string and the KEXINIT packet a server sends before anything is encrypted give the complete algorithm list, and the host key fingerprint comes from a key exchange. Findings call out what should no longer be offered — SHA-1 key exchange and MACs, CBC ciphers, RC4, DSA, RSA host keys under 2048 bits, protocol 1. Asking which sign-in methods are accepted is a separate checkbox, because it leaves one failed attempt in the other machine's log.

**The command half signs in** to a saved connection with its password or private key and runs one command, returning the output and the exit status. Presets cover the questions asked most often — a system snapshot, disk usage, failed services and recent errors, network configuration, listening sockets, pending updates, who is logged in and who failed — and there is a free-form command box next to them.

**The console** is a window that behaves like a shell. PHP-FPM ends every request, so a session cannot be held open; instead each line reconnects and carries the working directory across, which is enough for `cd`, `ls`, `tail`, `systemctl` and everything else that finishes on its own. Command history is on the arrow keys, `clear` and `exit` work. What it cannot do is run a program that expects a terminal — `vi`, `top`, an interactive password prompt — because there is nothing on the other end to type into.

## Files: FTP and SFTP

Choose a saved connection and browse it: directories, sizes, timestamps and permissions, with a path bar you can type into. Files move both ways — **to my files** copies a remote file into a folder of your Nextcloud files, and the upload field sends one of your Nextcloud files to the folder you are looking at. Folders can be created, renamed and deleted.

Transfers stream through a file handle in both directions, so a large file never lands in PHP's memory, and a download never overwrites: `report.csv` becomes `report (2).csv`.

FTP uses PHP's own `ext-ftp`, with or without TLS. SFTP uses the phpseclib copy Nextcloud already ships for its external-storage backends, so nothing extra is installed, and it signs in with either a password or a private key — see **Saved connections** for where the key goes.

## Telnet and the clock

**Telnet** answers the option negotiation politely and shows you the login screen, which is usually enough to tell which device it is — and the finding says what Telnet being open means.

**Clock check** asks an NTP server for the time and reports the offset. A drifted clock is behind more certificate and sign-in failures than anything else, and this is the fastest way to rule it in or out.

## Saved connections

The mail and file tools work from saved connections: type, host, port, encryption mode, user name and credential. They belong to the account that created them — there is no shared pool, because a stored password is one person's credential, not the instance's.

**Where the private key goes.** Choose *Private key* under **Sign in with** — it is offered for SSH and SFTP connections. Then either give the path of the key inside your own Nextcloud files (`Keys/id_ed25519`, the file without `.pub`), in which case the server reads it when you save and the key never passes through the browser at all, or paste the key into the box below that field. A passphrase, if the key has one, goes in the field next to the user name. OpenSSH and PEM formats are both accepted.

The password (or private key, with its passphrase) is encrypted with Nextcloud's own `ICrypto` before it reaches the database, decrypted only for the length of one connection, and **never sent back to the browser**: the interface is told only that a credential exists. Saving a connection again without retyping the password keeps the stored one. Protocol conversations shown in the interface have their credential lines masked.

## Requirements

Nextcloud 30–34 and PHP 8.1 or newer. **Nothing else is required**: device discovery, naming, vendor lookup, DNS, whois, subnet maths, the live throughput graph and the DNS resolver comparison all work on a stock PHP install.

Everything below is optional. Each entry buys one capability, and NetBase degrades to a documented fallback without it.

You do not have to read this table to find out where you stand. **System information**, at the bottom of the app's sidebar, shows this server's basics, the tools that work right now, and the ones that would start working if something were installed — with the install command for the package manager this machine actually has. Administrators see the same list, plus the commands, in **Administration settings → NetBase**; ordinary users see which capabilities are dormant without the system details.

| Component | Enables | Without it |
|---|---|---|
| `ext-sockets` (PHP) | Multicast discovery (WS-Discovery, SSDP) and Wake-on-LAN | Devices are still found and named over NetBIOS, mDNS and reverse DNS |
| `ext-curl` (PHP) | Internet speed test, HTTP timing breakdown | Those two features are unavailable; nothing else changes |
| `ext-ftp` (PHP) | Browsing FTP servers and moving files | SFTP still works — it uses the library Nextcloud already ships |
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

Nextcloud 用のネットワーク総合ツールです。LAN上の機器を検出して種別まで判別し、各機器の設定画面を Nextcloud の中から開き、日常的な調査ツールを同じ画面に揃えます。

## 各機能の仕組みと用途

### 機器ウィンドウ（機器の設定画面）

**仕組み** ― サーバーが機器のページを取得し、その中のアドレス（リンク、スタイルシート、スクリプト、フォーム、リダイレクト、meta refresh、ページのスクリプトが実行時に組み立てるものまで）をすべて書き換えて、機器のアドレスではなく Nextcloud のアドレスとして返します。ウィンドウごとに、対象アドレス・利用者・有効期限を記した署名付きの許可証を発行し、機器のログイン状態はサーバー側で保持するため、ページを移動してもログインが切れません。開けるのはこのサーバーが属するネットワーク上のアドレスと、検出済みの機器だけです。表示中のページは通信先がプロキシ経路に限定され、自分自身以外へは遷移できません。

**用途** ― 外出先から拠点ルーターの設定変更。プリンタのトナー残量やトレイ構成の確認。ファームウェア更新や設定ファイルの復元。VPN も踏み台も訪問もなしでの顧客機器の遠隔サポート。複数のウィンドウを同時に開いて並べられ、それぞれが表示履歴を覚えています。

### 機器の検出と台帳

**仕組み** ― Nextcloud は非特権で動作するため raw ソケット（つまり PHP からの ARP スキャン）は使えません。そこでカーネルに仕事をさせます。同一リンク上のアドレスへデータグラムを送るとカーネルは必ずアドレス解決を行い、その結果が誰でも読める近隣テーブルに残ります。名前は NetBIOS・mDNS・WS-Discovery・SSDP という素の UDP で機器自身に尋ね、ベンダーは同梱の IEEE 登録簿（53,000件超）で判定します。MACアドレスを外部へ送ることはありません。

**用途** ― 作りかけのまま放置されがちな機器台帳の整備。誰も覚えていない機器の発見。IPアドレス払い出し前の空き確認。CSV 書き出しによる社内資産管理との連携。

### DNS 調査

**仕組み** ― 問い合わせを生の DNS パケットとして組み立てるため、PHP 標準の関数では取得できない TLSA・DS・DNSKEY・SSHFP・CAA・SVCB も応答フラグ付きで取得できます。同じ問い合わせを複数のDNSサーバーへ同時に投げる比較、ルートからの委任追跡、ゾーン転送の要求も行えます。

**用途** ― 移転作業の浸透確認。拠点ごとに名前の解決結果が違う理由の特定。自社の権威サーバーがゾーン全体を第三者に渡していないかの点検。

### whois

**仕組み** ― まず IANA に尋ね、示されたレジストリ、さらにレジストラへと、委譲の連鎖を最後まで自動で追跡します。素のソケットで行うため `whois` コマンドは不要です。

**用途** ― ドメイン有効期限の事前把握。問題のあるアドレスの連絡先確認。移管前に、そのドメインが実際にどの登録業者にあるかの確認。

### TLS・HTTP 検査

**仕組み** ― 確立した通信から証明書・チェーン・有効期限を読み取り、TLS のバージョンを一つずつ提示して受け付けるものを判定、リダイレクト連鎖と応答ヘッダーを取得して評価します。

**用途** ― ブラウザに警告される前の証明書更新。監査で指摘される古い TLS の洗い出し。リダイレクトの最終到達先の確認。

### IP計算・MACベンダー照会

**仕組み** ― IPv4／IPv6 のアドレス計算。ネットワークの分割、散らばったアドレスの最小 CIDR への集約に対応します。MAC 照会は検出機能と同じ同梱データベースを使います。

**用途** ― アドレス再設計。過不足のないファイアウォール規則の作成。ログに残った MAC からの機器特定。

### 速度・品質のベンチマーク

**仕組み** ― インターフェース統計はカーネルの値をブラウザ側で差分。LAN は iperf3、回線速度は公開エンドポイントとの実測、DNS は複数サーバーの応答時間比較、HTTP は1回の要求を DNS・接続・TLS・待ち時間・転送に分解します。

**用途** ― 「ネットワークが遅い」を数値にする。遅いのがスイッチのポートか回線かの判別。機器交換や回線変更の前後比較。

### メールサーバー診断

**仕組み** ― SMTP・IMAP・POP3 を生のソケットで直接会話するため、現行 PHP に同梱されなくなった `ext-imap` を必要としません。DNS 側は MX・SPF・DKIM・DMARC・MTA-STS（ポリシーファイルの取得まで）・TLS-RPT・BIMI・DANE を読み、各 MX アドレスを7つの公開ブロックリストで照合します。

**用途** ― メールが届かない原因の切り分け。サーバー移行の前後確認。なりすまし対策レコードの妥当性と、第三者中継になっていないことの確認。

### FTP・SFTP

**仕組み** ― SFTP は Nextcloud が外部ストレージ用に同梱している phpseclib、FTP は PHP 標準の拡張（TLS の有無どちらも）。転送は双方向ともファイルハンドルで流すため、大きなファイルが PHP のメモリに載ることはありません。接続情報は Nextcloud の `ICrypto` で暗号化して保存し、その場入力での接続もできます。

**用途** ― 機器やサーバーへの設定ファイル配布。ログの回収。手元の PC を経由せずに、リモートサーバーと Nextcloud のフォルダー間でファイルを受け渡す。

### SSH・Telnet

**仕組み** ― 調査側は暗号化前にサーバーが名乗る識別文字列とアルゴリズム一覧、ホスト鍵のフィンガープリントを読むため、資格情報を一切必要としません。ログイン側は phpseclib でパスワードまたは秘密鍵を使います。PHP は要求をまたいで接続を保持できないため、コンソールは1行ごとに再接続し、作業ディレクトリを引き継ぎます。

**用途** ― 端末を開かずに拠点サーバーの空き容量・停止サービス・保留更新を確認する。提示アルゴリズムの棚卸し。Telnet ポートが何を晒しているかの確認と、開けたままにする意味の提示。

### 時刻確認

**仕組み** ― NTP サーバーへ UDP で時刻を問い合わせ、ずれを表示します。

**用途** ― 時刻ずれの切り分け。証明書エラーやログイン失敗の原因として、時刻ずれは最も多い部類です。

### システム情報

**仕組み** ― このサーバーのインターフェース・アドレス・経路・DNSサーバー・待受ソケットに加え、「いま使える機能」と「何を入れれば使えるようになる機能」を、このマシンのパッケージ管理に合わせた導入コマンド付きで一覧します。

**用途** ― 自分が立っている足場の把握。眠っている機能を、調べ回らずに動かす。

### 結果の持ち出し

**仕組み** ― どのツールの結果も、クリップボードへのコピー、テキストファイルのダウンロード、Nextcloud上の **NetBase** フォルダーへの保存ができます。ファイル名はツール名と日時で、既存のファイルを上書きしません。機器台帳は CSV 書き出しにも対応します。

**用途** ― 対応記録への証跡添付。作業前後の記録の保管。説明ではなく実際の出力そのものを同僚へ渡す。

### 公開範囲・表示・言語

**仕組み** ― NetBase は管理者向けのアプリで、ローカルネットワークに触れる機能（機器ウィンドウ、スキャン、Wake-on-LAN、メール検査、FTP・SFTP、SSH、機器台帳そのもの）は既定で管理者のみです。ただし公開範囲はツール単位で、**管理設定 → NetBase** から「管理者のみ／指定グループ／全員」を選べます。既定で閉じている機能も含め、どれでも開放できます。何も許可されていない利用者には、開かない扉を見せないよう、アプリメニューにも表示しません。テーマと言語は利用者ごと、サイドバーの並び順もドラッグで変更できます。

**用途** ― ネットワークそのものを渡さずに、ヘルプデスクに whois や DNS の照会だけ使ってもらう。移行作業の期間だけ機器台帳を特定グループに開放し、終わったら閉じる。

## ベンチマーク

| 計測 | わかること | 必要なもの |
|---|---|---|
| **実効スループット（ライブ）** | インターフェース毎の受信・送信レートを推移グラフで表示。エラー／破棄数も併記 | なし |
| **インターネット速度テスト** | 下り・上りの Mbps、接続遅延とジッター | `ext-curl` |
| **LANスループット** | ローカル回線の実力を双方向で計測。秒毎のグラフと再送数つき | このサーバーと相手側の `iperf3` |
| **DNSリゾルバ比較** | 各リゾルバの中央値・平均・ジッター。このサーバーが使っているリゾルバも含め、最速を明示 | なし |
| **時間の内訳** | HTTPリクエスト1回を DNS・TCP・TLS・サーバー処理・転送に分解 | `ext-curl` |

このうち2つには補足が必要です。

**実効スループット**は、カーネル自身のカウンター（`/proc/net/dev`）を読むだけです。負荷はなく、キャプチャ権限も不要で、取りこぼしも起きません。差分はブラウザ側で計算するため、各サンプルにはタイムスタンプが付いています。

**インターネット速度テストは LAN のテストではありません。** 計測しているのは外部エンドポイント（既定は Cloudflare）までの経路であり、通信を開始する前に接続先ホスト名を画面に明示します。LAN内の実力を測るには iperf3 のテストを使ってください。遅いのがスイッチのポートなのか回線なのかを見分ける、唯一の誠実な方法です。エンドポイントは `occ config:app:set netbase speedtest_down --value=...`（および `speedtest_up`）で変更できます。

## メール

必要になる順に、3つの画面を用意しています。

**ドメイン設定** はドメイン名を入力すると、DNSが公開しているメール関連の情報をすべて読み取ります。MXホストとそのアドレス・逆引き名（受信側が見るのと同じく、正引きと逆引きの双方向で確認）、SPFの各項目とDNS参照回数（上限10回に対する現在値）、DMARCのポリシーとレポート送付先、DKIM鍵とその鍵長、MTA-STS（HTTPSでのポリシーファイル取得を含む）、TLS-RPT、BIMI、DANE/TLSAレコード、クライアント自動設定のSRVレコード、そして各MXアドレスの公開ブロックリスト7種への掲載状況。最後に「何が壊れているか・何を見るべきか・何が問題ないか」を重要度順の平易な文章で提示します。

**サーバー検査** は1台のサーバーと実際に会話し、応答内容を報告します。グリーティング、対応機能の一覧、STARTTLSの有無と昇格後の証明書、実際に確立したプロトコルと暗号方式、そして認証方式。25・587・465・993・143・995番ポートはワンクリックのプリセットで切り替えられます。やり取りの全文も保持し、必要なときだけ表示します（資格情報は伏せ字になります）。その下に2つの追加機能があります。**オープンリレー検査**（外部の差出人と外部の宛先を提示し、送信の直前で停止します）と、任意のアドレスの**ブロックリスト照会**です。

**送受信テスト** は、利用者が本当に確かめたいことを証明します。保存済みのSMTP接続先を選んで実際にテストメールを送信し、保存済みのIMAP／POP3アカウントにサインインして、受信数・未読数・フォルダー一覧を確認します。

ここで扱うプロトコルは、すべてストリームソケットで直接会話しています。`ext-imap` は不要かつ未使用です。現在のPHPには同梱されなくなったため、この点は重要です。

## SSH: 調査とコマンド実行

意図して2つに分けています。

**調査には資格情報が要りません。** 暗号化が始まる前にサーバーが送る識別文字列とKEXINITパケットから提示アルゴリズムの全容が分かり、ホスト鍵のフィンガープリントは鍵交換で取得します。もはや提示すべきでないもの（SHA-1の鍵交換とMAC、CBC系暗号、RC4、DSA、2048ビット未満のRSAホスト鍵、プロトコル1）は所見として提示します。受け付けられる認証方式の確認だけは別のチェックボックスです。相手のログに失敗記録が1件残るためです。

**コマンド実行は**、保存済み接続先へパスワードまたは秘密鍵でサインインし、コマンドを1つ実行して出力と終了コードを返します。よく使う確認はプリセットにしてあります（システム概況・ディスク使用状況・失敗したサービスと直近のエラー・ネットワーク設定・待受ソケット・未適用の更新・ログイン状況）。自由入力の欄も併設しています。

**コンソール**は、シェルのように使えるウィンドウです。PHP-FPMはリクエストごとに終了するためセッションは保持できません。そこで1行ごとに接続し直し、カレントディレクトリを引き継ぐ方式にしました。`cd`・`ls`・`tail`・`systemctl` など、自分で終了するコマンドはこれで十分に動きます。コマンド履歴は上下キー、`clear` と `exit` も使えます。できないのは本物の端末を必要とするもの（`vi`・`top`・対話的なパスワード入力）です。入力を受け取る端末がそこに無いためです。

## ファイル: FTP・SFTP

保存済みの接続先を選ぶと、そのサーバーを閲覧できます。ディレクトリ・サイズ・更新日時・権限を表示し、パス欄には直接入力もできます。ファイルは双方向に移動できます。**「自分のファイルへ」** はリモートのファイルをNextcloud内のフォルダーへ取り込み、アップロード欄はNextcloud内のファイルを、いま開いているフォルダーへ送ります。フォルダーの作成・名前変更・削除にも対応します。

転送は双方向ともファイルハンドル経由のストリーム処理です。大きなファイルでもPHPのメモリに載りません。またダウンロードが既存ファイルを上書きすることはなく、`report.csv` は `report (2).csv` になります。

FTPはPHP標準の `ext-ftp` を使い、TLSの有無どちらにも対応します。SFTPは、Nextcloudが外部ストレージ用に同梱している phpseclib を利用するため追加導入は不要で、パスワードと秘密鍵のどちらでもサインインできます（鍵の指定方法は「接続先の保存」をご覧ください）。

## Telnet と時刻

**Telnet** はオプション交渉に穏当に応答し、ログイン画面を表示します。多くの場合それだけで機器を特定できます。あわせて、Telnetが開いていること自体の意味も提示します。

**時刻確認** はNTPサーバーに時刻を尋ね、ずれを報告します。証明書エラーやサインイン失敗の原因として時刻ずれは最も多く、これはその可能性を最短で切り分ける手段です。

## 接続先の保存

メールとファイルの各ツールは、保存した接続先（種別・ホスト・ポート・暗号化方式・ユーザー名・資格情報）から動作します。接続先は作成したアカウントに属し、共有プールはありません。保存されたパスワードは組織のものではなく、その人個人の資格情報だからです。

**秘密鍵の指定方法**：接続先の編集画面で「認証方式」を**秘密鍵**にしてください（SSH・SFTPの接続先で選べます）。指定方法は2通りです。ひとつは、ご自身のNextcloud内にある鍵ファイルのパスを入力する方法（例 `Keys/id_ed25519`。`.pub` が付かない方のファイル）。この場合、保存時にサーバーがファイルを読むため、鍵がブラウザーを通ることはありません。もうひとつは、その下の欄に鍵の本文を貼り付ける方法です。パスフレーズ付きの鍵は、ユーザー名の隣の欄に入力してください。OpenSSH形式・PEM形式のどちらも利用できます。

パスワード（および秘密鍵とそのパスフレーズ）は、データベースへ届く前にNextcloud標準の `ICrypto` で暗号化され、復号されるのは1回の接続の間だけです。そして**ブラウザーへ返されることはありません**。画面に伝えられるのは「資格情報が保存されている」という事実だけです。パスワードを入力し直さずに接続先を保存し直した場合、保存済みのものがそのまま維持されます。画面に表示されるプロトコルのやり取りでも、資格情報の行は伏せ字になります。

## 動作要件

Nextcloud 30〜34、PHP 8.1 以降。**それ以外は不要です。** 機器の検出・名前解決・ベンダー判別・DNS・whois・サブネット計算・実効スループットのグラフ・DNSリゾルバ比較は、いずれも素の PHP 環境でそのまま動作します。

以下はすべて任意です。それぞれが1つの機能を追加するもので、無い場合の代替動作も定めてあります。

現状を知るためにこの表を読む必要はありません。アプリ左下の**「システム情報」**に、このサーバーの基本情報、いま使えるツール、そして何かを導入すれば使えるようになるツールが、このマシンに実際に入っているパッケージマネージャー向けの導入コマンドつきで表示されます。管理者は**管理者設定 → NetBase** でも同じ一覧とコマンドを確認できます。一般の利用者にはシステムの詳細やコマンドは表示されず、どの機能が休止中かだけが分かります。

| コンポーネント | 追加される機能 | 無い場合 |
|---|---|---|
| `ext-sockets`（PHP） | マルチキャスト探索（WS-Discovery・SSDP）と Wake-on-LAN | NetBIOS・mDNS・逆引きによる検出と名前解決は引き続き行えます |
| `ext-curl`（PHP） | インターネット速度テスト、HTTPの時間内訳 | この2機能のみ利用不可。他に影響はありません |
| `ext-ftp`（PHP） | FTPサーバーの閲覧とファイル受け渡し | SFTPはNextcloud同梱のライブラリで動作します |
| `chromium` | **ページを表示** ― 機器のWeb画面をサーバーで描画して画像表示 | Webポートはリンクとしては利用できます |
| `iperf3` | LANスループット計測 | LAN内の実効速度を測れません |
| `ss`（iproute2） | 待受ソケット一覧 | `netstat` があればそちらを使用 |

導入だけでは足りないものが2つあります。

- **iperf3** ― 相手側で待ち受けが必要です: `iperf3 -s`

## 管理者向けの注意

**アクセス権.** ツールごとに利用範囲を設定できます（**管理者設定 → NetBase**）。選べるのは「管理者のみ」「管理者と指定グループ」「すべてのログイン利用者」の3段階で、管理者はつねに全ツールを利用できます。ローカルに何も送らない参照系（DNS・whois・TLS・サブネット計算）は、いずれも公開されたWebフォームと同程度の機能にすぎないため、既定で全利用者としています。一方、**調査の実行は閲覧とは別の権限**とし、Wake-on-LAN・サーバー情報とあわせて既定で管理者のみとしています。1回の掃引で数千のARPプローブを送出するため、誰でも任意に開始できる状態は避けるべきだからです。

利用できるツールが一つもない利用者に対しては、上部のアプリメニューに NetBase を表示せず、ページ自体も403を返します。この挙動は設定で切り替えられます。

**近隣テーブル.** 掃引はプローブしたアドレスごとにカーネルの近隣エントリを1件作ります。対象が `net.ipv4.neigh.default.gc_thresh3`（多くの環境で1024）を超えると、カーネルは強制的にガベージコレクションを行い `neighbour table overflow` をログに記録します。調査結果自体は正しく得られますが、それより大きい範囲を掃引する前に上限を引き上げられるよう、NetBase は実行すべき `sysctl` コマンドをそのまま提示します。

**安全性.** 外部コマンドをシェル経由で起動することはありません。引数は配列で渡し、シェルが解釈し直せるコマンド行にはしません。

## コマンドライン

```
occ netbase:scan [-t 192.168.1.0/24] [--gentle] [--arp-only] [--no-ports] [--json]
occ netbase:devices [--online] [--json]
```

## ライセンス

AGPL-3.0-or-later。同梱のベンダーデータベースは公開されている IEEE 登録簿から生成しています（`data/oui.source` を参照）。
