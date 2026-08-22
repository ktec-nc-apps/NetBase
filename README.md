# NetBase

Network toolbox for Nextcloud — fast LAN device discovery with vendor lookup, plus DNS, whois, ping, port, TLS and nmap tools.

NetBase turns your Nextcloud into a network console. It finds every device on your LAN in seconds and tells you what each one is, then keeps the everyday lookup tools on the same screen.

Discovery needs no root, no agent and no extra packages. Nextcloud runs unprivileged, so raw sockets — and therefore ARP scanning in PHP — are not available. NetBase makes the kernel do the work instead: sending a datagram to an on-link address forces the kernel to resolve it, and the result lands in the neighbour table, which is world readable. Names then come from the devices themselves over NetBIOS, mDNS, WS-Discovery and SSDP, all plain UDP.

## Features

- **Fast LAN sweep** — name, IPv4, MAC, vendor, device type and open ports, with live progress. A /24 takes about twenty seconds; a /16 finishes in well under a minute.
- **Offline vendor database** — the bundled IEEE MA-L / MA-M / MA-S registries cover more than 53,000 prefixes, so no MAC address is ever sent anywhere. Randomised (privacy) addresses are labelled as such rather than reported as unknown.
- **Names from the devices themselves** — NetBIOS node status, mDNS reverse lookup, WS-Discovery, SSDP and reverse DNS. Devices that stay silent during the sweep are asked again, more slowly, once the network is quiet.
- **Device inventory** — rename, classify, tag and annotate devices; first-seen and last-seen are tracked, and the list can be exported as CSV.
- **DNS toolkit** — A / AAAA / CNAME / MX / NS / TXT / SOA / SRV / CAA, with SPF and DMARC picked out, plus reverse lookups.
- **Whois** for domains and IP addresses, following IANA referrals to the registry and then the registrar. No `whois` binary required.
- **Ping, traceroute, TCP port check** with banner grab, and Wake-on-LAN.
- **TLS and HTTP inspector** — certificate subject, issuer, expiry, SANs and chain; redirect chain and security headers.
- **Subnet calculator** for IPv4 and IPv6.
- **Server network information** — interfaces, addresses, routes, resolvers and listening sockets.
- **nmap front end** — presets from host discovery to service detection, with results parsed from nmap's XML output. Available when nmap is installed.
- **Mail server testing** — the DNS side of a domain (MX, SPF, DKIM, DMARC, MTA-STS, DANE, blocklists) and the servers themselves (SMTP, IMAP, POP3), ending in a plain-language list of what to fix.
- **FTP and SFTP** — browse a remote server and move files between it and your own Nextcloud folders, with the connection details saved and encrypted.
- **SSH and Telnet probes** — host key fingerprint, offered algorithms and sign-in methods, without signing in.
- **Benchmarks** — see below.
- **Light or dark, per user** — NetBase follows the Nextcloud theme by default, and **Theme** at the bottom of the sidebar pins it to light or dark for that account alone. Nothing else in Nextcloud changes.
- Available in English and Japanese.

## Benchmarks

| Measurement | What it tells you | Needs |
|---|---|---|
| **Live throughput** | Receive and send rates per interface, with a running graph and the interface error/drop count | nothing |
| **Internet speed test** | Download and upload in Mbps, plus connect latency and jitter | `ext-curl` |
| **LAN throughput** | The real speed of the local link, in both directions, with a per-second graph and the retransmit count | `iperf3` here and on one other machine |
| **DNS resolver comparison** | Median, average and jitter for every resolver, including the one this server uses, with the fastest marked | nothing |
| **Where the time goes** | One HTTP request broken into DNS, TCP, TLS, server think-time and transfer | `ext-curl` |
| **Path quality** | Packet loss and latency at every hop along a route | `mtr` |

Two of these deserve a note.

**Live throughput** is read from the kernel's own counters in `/proc/net/dev`, so it costs nothing, needs no capture privileges and cannot miss traffic. It is differentiated in the browser, which is why a timestamp travels with each sample.

**The internet speed test is not a LAN test.** It measures the path to a public endpoint — by default Cloudflare's, and the interface names the host before anything is transferred. To measure the local link, use the iperf3 test: it is the only honest way to tell a slow switch port from a slow internet connection. The endpoint can be changed with `occ config:app:set netbase speedtest_down --value=...` (and `speedtest_up`).

## Mail

Three views, in the order you actually need them.

**Domain policy** takes a domain name and reads everything DNS publishes about its mail: the MX hosts with their addresses and reverse names (checked both ways, because receivers do), SPF with its terms and its DNS-lookup count against the limit of ten, DMARC with its policy and reporting address, DKIM keys with their size, MTA-STS (including fetching the policy file over HTTPS), TLS-RPT, BIMI, DANE/TLSA records, the client autoconfiguration SRV records, and each MX address against seven public blocklists. It ends with a ranked list of findings in plain language — what is broken, what is worth looking at, what is fine.

**Server test** talks to one server and reports what it offers: the greeting, the capability list, whether STARTTLS is there and what the certificate looks like once it is, the negotiated protocol and cipher, and the sign-in mechanisms. One-click presets cover ports 25, 587, 465, 993, 143 and 995. The full conversation is kept and shown on request, with credentials masked. Two extras sit under it: an **open-relay test** — a foreign sender and a foreign recipient offered to the server, stopping before anything is sent — and a **blocklist lookup** for any address.

**Send and receive** proves the thing people actually care about. Pick a saved SMTP connection and send a real test message; pick a saved IMAP or POP3 account and sign in to see the message and unread counts and the folder list.

Every protocol here is spoken directly over a stream socket. `ext-imap` is neither needed nor used, which matters because it no longer ships with current PHP.

## Files: FTP and SFTP

Choose a saved connection and browse it: directories, sizes, timestamps and permissions, with a path bar you can type into. Files move both ways — **to my files** copies a remote file into a folder of your Nextcloud files, and the upload field sends one of your Nextcloud files to the folder you are looking at. Folders can be created, renamed and deleted.

Transfers stream through a file handle in both directions, so a large file never lands in PHP's memory, and a download never overwrites: `report.csv` becomes `report (2).csv`.

FTP uses PHP's own `ext-ftp`, with or without TLS. SFTP uses the phpseclib copy Nextcloud already ships for its external-storage backends, so nothing extra is installed, and it signs in with either a password or a private key.

## SSH, Telnet and the clock

**SSH** is read straight off the wire. The identification string and the KEXINIT packet a server sends before anything is encrypted give the complete algorithm list, and the host key fingerprint (SHA256, in the format OpenSSH prints) comes from a key exchange. NetBase flags what should no longer be offered — SHA-1 key exchange and MACs, CBC ciphers, RC4, DSA, RSA host keys under 2048 bits, protocol 1. Asking which sign-in methods are accepted is a separate checkbox, because it leaves one failed attempt in the other machine's log.

**Telnet** answers the option negotiation politely and shows you the login screen, which is usually enough to tell which device it is — and the finding says what Telnet being open means.

**Clock check** asks an NTP server for the time and reports the offset. A drifted clock is behind more certificate and sign-in failures than anything else, and this is the fastest way to rule it in or out.

## Saved connections

The mail and file tools work from saved connections: type, host, port, encryption mode, user name and credential. They belong to the account that created them — there is no shared pool, because a stored password is one person's credential, not the instance's.

The password (or private key, with its passphrase) is encrypted with Nextcloud's own `ICrypto` before it reaches the database, decrypted only for the length of one connection, and **never sent back to the browser**: the interface is told only that a credential exists. Saving a connection again without retyping the password keeps the stored one. Protocol conversations shown in the interface have their credential lines masked.

## Requirements

Nextcloud 30–34 and PHP 8.1 or newer. **Nothing else is required**: device discovery, naming, vendor lookup, DNS, whois, port checks, subnet maths, the live throughput graph and the DNS resolver comparison all work on a stock PHP install.

Everything below is optional. Each entry buys one capability, and NetBase degrades to a documented fallback without it.

You do not have to read this table to find out where you stand. **System information**, at the bottom of the app's sidebar, shows this server's basics, the tools that work right now, and the ones that would start working if something were installed — with the install command for the package manager this machine actually has. Administrators see the same list, plus the commands, in **Administration settings → NetBase**; ordinary users see which capabilities are dormant without the system details.

| Component | Enables | Without it |
|---|---|---|
| `ext-sockets` (PHP) | Multicast discovery (WS-Discovery, SSDP) and Wake-on-LAN | Devices are still found and named over NetBIOS, mDNS and reverse DNS |
| `ext-curl` (PHP) | Internet speed test, HTTP timing breakdown | Those two features are unavailable; nothing else changes |
| `ext-ftp` (PHP) | Browsing FTP servers and moving files | SFTP still works — it uses the library Nextcloud already ships |
| `iperf3` | LAN throughput measurement | Local link speed cannot be measured |
| `nmap` | The nmap tab | NetBase still sweeps the LAN and checks common ports itself |
| `mtr` | Per-hop packet loss and latency | Traceroute still shows the path, without loss statistics |
| `traceroute` | Path tracing | Falls back to `tracepath` |
| `ping` | Round-trip times | Reachability is still inferred from the TCP port check |
| `ss` (iproute2) | The listening-sockets list | Falls back to `netstat` |

Two components want more than an install:

- **nmap** — SYN, OS and UDP scans need raw sockets. Without them NetBase hides those presets and says why. To grant them: `sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip $(command -v nmap)`
- **iperf3** — the far end has to be listening: `iperf3 -s`

## Notes for administrators

**Access.** Every tool has its own access level, set in **Administration settings → NetBase**: administrators only, administrators plus named groups, or every signed-in user. Administrators always have everything. Reading the device list, ping and the lookups that touch nothing locally (DNS, whois, TLS, subnet maths) default to every signed-in user, because none of them is more powerful than a public web form. Running a sweep is a separate permission from reading its result, and it defaults to administrators along with port checks, nmap, Wake-on-LAN and the server view — a sweep puts thousands of ARP probes on the wire, so it should not be something any account can start at will.

When a user is allowed no tool at all, NetBase leaves itself out of that user's app menu and its page answers 403. That behaviour is a setting, so an instance can advertise the app to everyone if it prefers.

**Neighbour table.** A sweep creates one kernel neighbour entry per probed address. If the target is larger than `net.ipv4.neigh.default.gc_thresh3` (1024 on most systems), the kernel forces garbage collection and logs `neighbour table overflow`. The scan is still correct, but NetBase shows the exact `sysctl` command to raise the limit before you sweep anything larger than that.

**Safety.** External binaries are never invoked through a shell — arguments are passed as an array — and nmap options are restricted to an allow-list that refuses anything writing files, reading target lists or loading scripts from disk.

## Command line

```
occ netbase:scan [-t 192.168.1.0/24] [--gentle] [--arp-only] [--no-ports] [--json]
occ netbase:devices [--online] [--json]
```

## Licence

AGPL-3.0-or-later. The bundled vendor database is derived from the public IEEE registries (see `data/oui.source`).

---

# NetBase（日本語）

Nextcloud 用のネットワーク総合ツールです。LAN上の機器を高速に検出してベンダーまで判別し、DNS・whois・ping・ポート・TLS・nmap といった日常的な調査ツールを同じ画面に揃えます。

検出に root 権限・エージェント・追加パッケージは必要ありません。Nextcloud は非特権で動作するため raw ソケット（つまり PHP からの ARP スキャン）は使えません。そこで NetBase はカーネルに仕事をさせます。同一リンク上のアドレスへデータグラムを送るとカーネルは必ずアドレス解決を行い、その結果が誰でも読める近隣テーブルに残ります。名前は NetBIOS・mDNS・WS-Discovery・SSDP という、いずれも素の UDP で機器自身に尋ねて取得します。

## 主な機能

- **LAN高速スキャン** ― 機器名・IPv4・MAC・ベンダー・機器種別・開放ポートを進捗表示付きで一覧します。/24 で約20秒、/16 でも1分を大きく下回ります。
- **オフラインのベンダーデータベース** ― IEEE の MA-L / MA-M / MA-S 登録簿（53,000件超）を同梱しているため、MACアドレスを外部へ送信することは一切ありません。ランダム化（プライバシー）MACは「不明」ではなく、その旨を明示します。
- **機器自身が名乗る名前** ― NetBIOS ノードステータス、mDNS逆引き、WS-Discovery、SSDP、逆引きDNS。掃引中に応答しなかった機器へは、通信が静まってからゆっくり再度問い合わせます。
- **機器台帳** ― 名称変更・種別変更・タグ・メモに対応し、初回検出と最終検出を記録します。CSV書き出しも可能です。
- **DNSツール** ― A / AAAA / CNAME / MX / NS / TXT / SOA / SRV / CAA に加え、SPF・DMARC を抽出。逆引きにも対応します。
- **whois** ― ドメインとIPアドレス。IANA から各レジストリ、さらにレジストラへと委譲先を自動で追跡します。`whois` コマンドは不要です。
- **ping・traceroute・TCPポート確認**（バナー取得つき）と **Wake-on-LAN**。
- **TLS・HTTP検査** ― 証明書のサブジェクト・発行者・有効期限・SAN・チェーン、リダイレクト連鎖とセキュリティヘッダー。
- **サブネット計算**（IPv4／IPv6）。
- **サーバーのネットワーク情報** ― インターフェース・アドレス・経路・DNSサーバー・待受ソケット。
- **nmap のフロントエンド** ― ホスト探索からサービス判定までのプリセットを用意し、結果は nmap の XML 出力を解析して表示します。nmap 導入時に利用できます。
- **メールサーバー検査** ― ドメイン側の設定（MX・SPF・DKIM・DMARC・MTA-STS・DANE・ブロックリスト）とサーバー本体（SMTP・IMAP・POP3）を調べ、「何を直すべきか」を平易な文章で提示します。
- **FTP・SFTP** ― リモートサーバーを閲覧し、Nextcloud内のフォルダーとの間でファイルを受け渡します。接続情報は暗号化して保存できます。
- **SSH・Telnet調査** ― サインインせずに、ホスト鍵のフィンガープリント・提示アルゴリズム・認証方式を確認します。
- **ベンチマーク** ― 下記をご覧ください。
- **ライト／ダークの個別切り替え** ― 既定では Nextcloud のテーマに追従します。サイドバー下部の「表示テーマ」から、利用者ごとに常時ライト／常時ダークへ固定できます。Nextcloud 全体の設定には影響しません。
- 英語・日本語に対応。

## ベンチマーク

| 計測 | わかること | 必要なもの |
|---|---|---|
| **実効スループット（ライブ）** | インターフェース毎の受信・送信レートを推移グラフで表示。エラー／破棄数も併記 | なし |
| **インターネット速度テスト** | 下り・上りの Mbps、接続遅延とジッター | `ext-curl` |
| **LANスループット** | ローカル回線の実力を双方向で計測。秒毎のグラフと再送数つき | このサーバーと相手側の `iperf3` |
| **DNSリゾルバ比較** | 各リゾルバの中央値・平均・ジッター。このサーバーが使っているリゾルバも含め、最速を明示 | なし |
| **時間の内訳** | HTTPリクエスト1回を DNS・TCP・TLS・サーバー処理・転送に分解 | `ext-curl` |
| **経路品質** | 経路上のホップ毎のパケット損失と遅延 | `mtr` |

このうち2つには補足が必要です。

**実効スループット**は、カーネル自身のカウンター（`/proc/net/dev`）を読むだけです。負荷はなく、キャプチャ権限も不要で、取りこぼしも起きません。差分はブラウザ側で計算するため、各サンプルにはタイムスタンプが付いています。

**インターネット速度テストは LAN のテストではありません。** 計測しているのは外部エンドポイント（既定は Cloudflare）までの経路であり、通信を開始する前に接続先ホスト名を画面に明示します。LAN内の実力を測るには iperf3 のテストを使ってください。遅いのがスイッチのポートなのか回線なのかを見分ける、唯一の誠実な方法です。エンドポイントは `occ config:app:set netbase speedtest_down --value=...`（および `speedtest_up`）で変更できます。

## メール

必要になる順に、3つの画面を用意しています。

**ドメイン設定** はドメイン名を入力すると、DNSが公開しているメール関連の情報をすべて読み取ります。MXホストとそのアドレス・逆引き名（受信側が見るのと同じく、正引きと逆引きの双方向で確認）、SPFの各項目とDNS参照回数（上限10回に対する現在値）、DMARCのポリシーとレポート送付先、DKIM鍵とその鍵長、MTA-STS（HTTPSでのポリシーファイル取得を含む）、TLS-RPT、BIMI、DANE/TLSAレコード、クライアント自動設定のSRVレコード、そして各MXアドレスの公開ブロックリスト7種への掲載状況。最後に「何が壊れているか・何を見るべきか・何が問題ないか」を重要度順の平易な文章で提示します。

**サーバー検査** は1台のサーバーと実際に会話し、応答内容を報告します。グリーティング、対応機能の一覧、STARTTLSの有無と昇格後の証明書、実際に確立したプロトコルと暗号方式、そして認証方式。25・587・465・993・143・995番ポートはワンクリックのプリセットで切り替えられます。やり取りの全文も保持し、必要なときだけ表示します（資格情報は伏せ字になります）。その下に2つの追加機能があります。**オープンリレー検査**（外部の差出人と外部の宛先を提示し、送信の直前で停止します）と、任意のアドレスの**ブロックリスト照会**です。

**送受信テスト** は、利用者が本当に確かめたいことを証明します。保存済みのSMTP接続先を選んで実際にテストメールを送信し、保存済みのIMAP／POP3アカウントにサインインして、受信数・未読数・フォルダー一覧を確認します。

ここで扱うプロトコルは、すべてストリームソケットで直接会話しています。`ext-imap` は不要かつ未使用です。現在のPHPには同梱されなくなったため、この点は重要です。

## ファイル: FTP・SFTP

保存済みの接続先を選ぶと、そのサーバーを閲覧できます。ディレクトリ・サイズ・更新日時・権限を表示し、パス欄には直接入力もできます。ファイルは双方向に移動できます。**「自分のファイルへ」** はリモートのファイルをNextcloud内のフォルダーへ取り込み、アップロード欄はNextcloud内のファイルを、いま開いているフォルダーへ送ります。フォルダーの作成・名前変更・削除にも対応します。

転送は双方向ともファイルハンドル経由のストリーム処理です。大きなファイルでもPHPのメモリに載りません。またダウンロードが既存ファイルを上書きすることはなく、`report.csv` は `report (2).csv` になります。

FTPはPHP標準の `ext-ftp` を使い、TLSの有無どちらにも対応します。SFTPは、Nextcloudが外部ストレージ用に同梱している phpseclib を利用するため追加導入は不要で、パスワードと秘密鍵のどちらでもサインインできます。

## SSH・Telnet・時刻

**SSH** は通信路から直接読み取ります。暗号化が始まる前にサーバーが送る識別文字列とKEXINITパケットから、提示アルゴリズムの全容が分かります。ホスト鍵のフィンガープリント（SHA256・OpenSSHと同じ表記）は鍵交換によって取得します。もはや提示すべきでないもの（SHA-1の鍵交換とMAC、CBC系暗号、RC4、DSA、2048ビット未満のRSAホスト鍵、プロトコル1）は警告として提示します。受け付けられる認証方式の確認だけは別のチェックボックスにしてあります。相手のログに失敗記録が1件残るためです。

**Telnet** はオプション交渉に穏当に応答し、ログイン画面を表示します。多くの場合それだけで機器を特定できます。あわせて、Telnetが開いていること自体の意味も提示します。

**時刻確認** はNTPサーバーに時刻を尋ね、ずれを報告します。証明書エラーやサインイン失敗の原因として時刻ずれは最も多く、これはその可能性を最短で切り分ける手段です。

## 接続先の保存

メールとファイルの各ツールは、保存した接続先（種別・ホスト・ポート・暗号化方式・ユーザー名・資格情報）から動作します。接続先は作成したアカウントに属し、共有プールはありません。保存されたパスワードは組織のものではなく、その人個人の資格情報だからです。

パスワード（および秘密鍵とそのパスフレーズ）は、データベースへ届く前にNextcloud標準の `ICrypto` で暗号化され、復号されるのは1回の接続の間だけです。そして**ブラウザーへ返されることはありません**。画面に伝えられるのは「資格情報が保存されている」という事実だけです。パスワードを入力し直さずに接続先を保存し直した場合、保存済みのものがそのまま維持されます。画面に表示されるプロトコルのやり取りでも、資格情報の行は伏せ字になります。

## 動作要件

Nextcloud 30〜34、PHP 8.1 以降。**それ以外は不要です。** 機器の検出・名前解決・ベンダー判別・DNS・whois・ポート確認・サブネット計算・実効スループットのグラフ・DNSリゾルバ比較は、いずれも素の PHP 環境でそのまま動作します。

以下はすべて任意です。それぞれが1つの機能を追加するもので、無い場合の代替動作も定めてあります。

現状を知るためにこの表を読む必要はありません。アプリ左下の**「システム情報」**に、このサーバーの基本情報、いま使えるツール、そして何かを導入すれば使えるようになるツールが、このマシンに実際に入っているパッケージマネージャー向けの導入コマンドつきで表示されます。管理者は**管理者設定 → NetBase** でも同じ一覧とコマンドを確認できます。一般の利用者にはシステムの詳細やコマンドは表示されず、どの機能が休止中かだけが分かります。

| コンポーネント | 追加される機能 | 無い場合 |
|---|---|---|
| `ext-sockets`（PHP） | マルチキャスト探索（WS-Discovery・SSDP）と Wake-on-LAN | NetBIOS・mDNS・逆引きによる検出と名前解決は引き続き行えます |
| `ext-curl`（PHP） | インターネット速度テスト、HTTPの時間内訳 | この2機能のみ利用不可。他に影響はありません |
| `ext-ftp`（PHP） | FTPサーバーの閲覧とファイル受け渡し | SFTPはNextcloud同梱のライブラリで動作します |
| `iperf3` | LANスループット計測 | LAN内の実効速度を測れません |
| `nmap` | nmapタブ | NetBase 自身による掃引と主要ポート確認は引き続き動作します |
| `mtr` | ホップ毎のパケット損失と遅延 | traceroute で経路自体は確認できます（損失統計なし） |
| `traceroute` | 経路の追跡 | `tracepath` があればそちらを使用 |
| `ping` | 往復時間 | TCPポート確認から到達性は判断できます |
| `ss`（iproute2） | 待受ソケット一覧 | `netstat` があればそちらを使用 |

導入だけでは足りないものが2つあります。

- **nmap** ― SYN・OS判定・UDPスキャンには raw ソケット権限が必要です。権限が無い場合、NetBase は該当プリセットを実行せず理由を表示します。付与するには `sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip $(command -v nmap)`
- **iperf3** ― 相手側で待ち受けが必要です: `iperf3 -s`

## 管理者向けの注意

**アクセス権.** ツールごとに利用範囲を設定できます（**管理者設定 → NetBase**）。選べるのは「管理者のみ」「管理者と指定グループ」「すべてのログイン利用者」の3段階で、管理者はつねに全ツールを利用できます。機器リストの閲覧・ping・ローカルに何も送らない参照系（DNS・whois・TLS・サブネット計算）は、いずれも公開されたWebフォームと同程度の機能にすぎないため、既定で全利用者としています。一方、**調査の実行は閲覧とは別の権限**とし、ポート確認・nmap・Wake-on-LAN・サーバー情報とあわせて既定で管理者のみとしています。1回の掃引で数千のARPプローブを送出するため、誰でも任意に開始できる状態は避けるべきだからです。

利用できるツールが一つもない利用者に対しては、上部のアプリメニューに NetBase を表示せず、ページ自体も403を返します。この挙動は設定で切り替えられます。

**近隣テーブル.** 掃引はプローブしたアドレスごとにカーネルの近隣エントリを1件作ります。対象が `net.ipv4.neigh.default.gc_thresh3`（多くの環境で1024）を超えると、カーネルは強制的にガベージコレクションを行い `neighbour table overflow` をログに記録します。調査結果自体は正しく得られますが、それより大きい範囲を掃引する前に上限を引き上げられるよう、NetBase は実行すべき `sysctl` コマンドをそのまま提示します。

**安全性.** 外部コマンドをシェル経由で起動することはありません（引数は配列で渡します）。nmap のオプションは許可リスト方式で、ファイル書き出し・対象リスト読み込み・ディスク上のスクリプト読み込みを伴うものは拒否します。

## コマンドライン

```
occ netbase:scan [-t 192.168.1.0/24] [--gentle] [--arp-only] [--no-ports] [--json]
occ netbase:devices [--online] [--json]
```

## ライセンス

AGPL-3.0-or-later。同梱のベンダーデータベースは公開されている IEEE 登録簿から生成しています（`data/oui.source` を参照）。
