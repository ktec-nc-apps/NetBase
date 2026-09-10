# Changelog

All notable changes to NetBase are documented here.

## 0.5.0 — 2026-09-10

### Added

- **Clear the ARP table (optional, opt-in).** A "Clear the ARP table" button in
  the device list forgets every remembered address so a refresh shows only what
  answers now. NetBase runs unprivileged and cannot flush the kernel table itself,
  so the button stays off until an administrator installs a tiny root helper and a
  one-line sudoers rule — a "?" beside the button shows the exact script and steps
  (for bare metal/VM and for Docker/Podman with NET_ADMIN), and NetBase probes the
  helper with a harmless "--check" and switches the button on by itself once it
  works. It is clearly marked optional, with a note not to install it if the
  security trade-off (granting the web user one root command) is unwelcome.
  （【任意・オプトイン】ARPテーブルのクリア機能を追加。機器一覧の「ARPテーブルをクリア」で
  記憶したアドレスを忘れ、更新時に今応答する機器だけを表示します。NetBaseは無権限のため自身では
  消せず、管理者が小さなrootヘルパーとsudoers設定を入れるまでボタンは無効。横の「?」から
  スクリプトと手順（物理/仮想・Docker/Podman＝NET_ADMIN）を表示し、NetBaseは無害な「--check」で
  検出して自動的にボタンを有効化します。任意である旨と、セキュリティ上のトレードオフに納得
  できない場合は設置しない注意も明記。）
- **Every tool now shows when it is working.** A slim bar slides across the top of
  the panel while any request is in flight, and the button you pressed shows a
  spinner — so an operation with no progress count of its own (Whois, TLS, DNS,
  mail, SSH, NTP…) no longer looks like nothing is happening.
  （各機能の「実行中」表示を追加。リクエスト中はパネル上部に細いバーが流れ、押したボタンに
  スピナーが出ます。進捗の数値を持たない操作（Whois・TLS・DNS・メール・SSH・NTPなど）でも
  実行中だと分かります。）

- **You can now give a device your own name.** Type a name in a device's
  properties and it is shown everywhere in place of the discovered one; if a name
  was picked up from the network, that reported name stays visible in the
  properties as well. The name you give is kept against the device, so it holds
  even when the device offers no name of its own.
  （自分で機器名前をつけることが出来るようにしました。プロパティであなたが記入した名称を
  優先的に表示し、もしアナウンス名が取得できている場合は、プロパティで確認できます。）
- **The properties now say how a name was obtained** — NetBIOS, mDNS or reverse
  DNS — so a reported name is never mistaken for a NetBIOS name when it came from
  somewhere else.
  （プロパティに、その名前をどの方式で取得したか（NetBIOS／mDNS／逆引きDNS）を表示する
  ようにしました。取得元が分かるので、mDNSや逆引きの名前をNetBIOS名と取り違えません。）
- **In Docker or Nextcloud-AIO, the Requirements screen now shows a ready-to-use
  setup recipe.** An app cannot bundle PHP extensions, but the official Nextcloud
  image runs any script placed in `/docker-entrypoint-hooks.d/before-starting/`
  on every start. When NetBase detects it is in a container, it lists exactly what
  the base image is missing (verified on the official image: the `sockets`
  extension, and `chromium`/`iperf3`/`iproute2`) as a one-off script that survives
  image updates without a rebuild.
  （Docker・Nextcloud-AIO で動作している場合、「必要要件」画面にそのまま使える導入手順を
  表示するようにしました。アプリはPHP拡張を同梱できませんが、公式Nextcloudイメージは
  `/docker-entrypoint-hooks.d/before-starting/` に置いたスクリプトを起動のたびに実行します。
  コンテナ内と判定すると、ベースイメージに不足している要素（公式イメージで確認：`sockets`拡張と
  `chromium`/`iperf3`/`iproute2`）を、再ビルド不要で更新後も維持される一度きりのスクリプトとして
  提示します。）

- **A device that has been switched off is no longer shown as online.** Its
  entry lingers in the kernel neighbour table as STALE, keeping its old MAC, and
  /proc/net/arp cannot tell that apart from a device that is here now — so a
  powered-off machine kept a green dot. NetBase now reads the neighbour state
  (via `ip neigh`) and, without walking the whole range, confirms the addresses
  on file with a quick TCP touch: a host that is here answers a connection
  (open or refused), one that is gone stays silent and is marked offline. On a
  re-scan the online/offline column is current. (Announce-only devices — an
  Amazon Echo, say — are still kept online by what they broadcast over mDNS/SSDP
  in a normal scan.)
  （電源を切った機器がオンライン表示のままになる不具合を修正。カーネルの近隣テーブルに
  STALE として古いMACのまま残り、/proc/net/arp では在席中の機器と区別できないため、緑点が
  残っていた。近隣の状態を `ip neigh` で読み、全アドレス走査はせずに、記録済みアドレスを
  短いTCP接触で確認するようにした（在席なら接続に応答＝開放でも拒否でも、不在なら無応答で
  オフライン判定）。再スキャンでオンライン/オフラインが最新になる。※mDNS/SSDPで自ら告知する
  機器（Amazon Echo等）は、通常スキャンでは告知により在席のまま維持される。）

### Removed

- **Device tags have been removed.** They could not be seen in the list and
  served little purpose; identify a device with the name you give it (above)
  instead. Notes are kept.
  （機器のタグを廃止しました。一覧に表示されず用途が薄かったためで、機器の識別は上記の
  「自分でつけた名前」で行ってください。メモは残しています。）

### Changed

- **The free-domain search can hide the taken and the could-not-check results.**
  Two slide switches (the same control the device list uses) sit over the
  results: one for taken (×) names, one for the ones that could not be checked
  (?). Undetermined names are hidden by default, so the list leads with what is
  free or clearly taken. A taken name is shown greyed out; an unchecked one is
  greyed and struck through once, with the reason in its hover tooltip — no
  English text on the row.
  （空きドメイン検索で、使用済みと調査不能のドメインを隠せるようにしました。結果の上に
  スライドスイッチを2つ（接続機器調査と同じ部品）置き、使用済み（×）用と調査不能（?）用を
  用意。調査不能は初期状態で非表示にし、空きと使用済みが先に見えるようにしています。使用済みは
  グレー表示、調査不能はグレー＋一重打ち消し線で示し、理由はマウスオーバーで表示します（行に
  英語は出しません）。）
- **The free-domain search shows its results in columns on a wide screen.** The
  list flows into as many columns as the width allows (roughly one per 300px), so
  a wide window shows two or three side by side and a narrow one stays a single
  list. Each ending's name always shows in full; the diagnostic note beside it is
  what gives way when space is tight.
  （空きドメイン検索の結果を、画面幅に余裕があるとき複数列で表示するようにしました。幅に応じて
  自動で2〜3列になり、狭いときは1列に戻ります。語尾（ドメイン名）は常に全部表示し、横の理由
  表示のほうを省略します。）
- **Every column in a device's address lines is now aligned.** A device with
  several addresses lays them out in fixed columns so the eye can read down them:
  the network badge leads in a fixed-width slot (sized for 副ネットワーク9 / another
  network), then the IP and MAC at their known maxima (18 and 17 characters), then
  the full vendor name in a column half the width of the OUI database's longest
  name (54 characters, wrapping if longer, never truncated), then the open ports —
  which, because everything before them is fixed-width, begin at the same column on
  every row. Several addresses on one device are separated by a thin dotted rule.
  （機器のアドレス行の各列を整列させました。複数アドレスを持つ機器では、ネットワークバッジ
  （副ネットワーク9／別ネットワークに合わせた固定幅）→IP・MAC（最大幅18・17文字）→ベンダー名
  （OUI辞書の最長の約半分＝54文字の固定幅・超過は折返し・省略なし）→開放ポート、の順に固定幅で
  並べ、ポートの先頭が全行で同じ位置から始まるようにしました。複数アドレスは細い点線で区切ります。）
- **The device scan is now two buttons: "Refresh devices" and "Port scan".**
  "Refresh devices" re-checks which devices are online without scanning ports, so
  it is fast; "Port scan" is the fuller sweep that also reads each device's open
  ports. The per-device "Scan every port" search stays in a device's own
  properties, now labelled as being for that one device.
  （機器スキャンを「機器一覧を更新」と「ポートスキャン」の2つのボタンに分けました。
  「機器一覧を更新」はポートを調べずオンライン/オフラインを再判定する高速版、「ポートスキャン」は
  各機器の開放ポートも調べる本格版です。機器ごとの全ポート調査はプロパティ内に残し、「この機器の」と
  明示しました。）
- **"Online only" is now an on/off switch** instead of a button that swapped its
  own label.
  （「オンラインのみ」を、ラベルが入れ替わるボタンから、オン/オフのスライドスイッチにしました。）
- **The scan progress is clearer.** Each step is named as it runs (reading the
  ARP table, searching for devices, asking for names, multicast discovery,
  checking ports, reverse DNS), the multicast step shows a "listening" state
  while it waits instead of appearing frozen, and the bar no longer reads as
  going backwards between steps.
  （スキャンの進捗表示を分かりやすくしました。実行中の工程名（ARPテーブル読み込み／機器を探索／
  名前を問い合わせ／マルチキャスト探索／ポート確認／逆引きDNS）を表示し、マルチキャストの受信待ちを
  「探索中」と示して固まって見えないようにし、工程が変わるたびにバーが戻って見えないようにしました。）
- **"What to scan" lists "The ARP table only" first**, before "The whole
  network".
  （「スキャン対象」の並びを、「ARPテーブルのみ」を先頭にしました。）
- **A device's note is now shown in the list and is searchable.** It used to be
  visible only in the properties; now it appears under the device (one line,
  full text on hover) and the filter box matches it too, so a note like "2F
  printer" is actually useful for finding and telling devices apart.
  （機器のメモを一覧にも表示し、検索対象にしました。これまではプロパティでしか見えません
  でしたが、機器の下に1行（全文はホバー）で表示し、絞り込み欄でも一致するようにしたので、
  「2Fの複合機」のようなメモが機器の識別・検索に役立ちます。）

### Fixed

- **Mail: STARTTLS mode never sends the password in the clear.** If a server does
  not offer STARTTLS (or a network strips it), the sign-in, mailbox and send-test
  now stop with a clear message instead of falling through to plaintext AUTH.
  （メール：STARTTLSモードで平文送信しないよう修正。サーバーがSTARTTLSを提供しない（または
  経路で除去された）場合、平文認証に進まず明確なメッセージで停止します。）
- **Mail: the SPF DNS-lookup count no longer double-counts includes.** A top-level
  `include:` was counted twice, so a healthy record with a few includes could be
  reported as over the 10-lookup limit; it now counts each lookup once.
  （メール：SPFのDNSルックアップ数がincludeを二重計上する不具合を修正。正常な記録が上限超過と
  誤表示されることがありました。）
- **HTTP check: an unreachable host is reported as unreachable.** A host that
  refuses the connection or times out was shown as a reachable server missing every
  security header; it now says it could not connect. A redirect's target host is
  validated too, so a page cannot bounce the fetch onto an internal address.
  （HTTP確認：到達不能なホストを「稼働中でヘッダ欠落」と誤表示せず「接続できませんでした」と
  表示。リダイレクト先ホストも検証し、内部アドレスへ飛ばされないようにしました。）
- **A registered .jp/.co.jp domain is no longer reported as free.** JPRS answers
  with a "Domain Information" block whose fields are letter-prefixed
  ("a. [Domain Name]", "p. [Name Server]"), which the registered-check did not
  recognise, so a plainly taken name (google.co.jp) — and a suspended/pending-
  delete one (granz.co.jp) — came back undecided and was then labelled likely-free.
  A [Domain Name] / [State] block now means taken; a bare "No match!!" still means
  free.
  （登録済みの .jp/.co.jp が「空き」と表示される不具合を修正。JPRSは項目名が
  「a. [Domain Name]」のように接頭辞付きで返るため登録判定に一致せず、明らかに使用中の名前
  （google.co.jp）や停止中の名前（granz.co.jp）が「空きの可能性」になっていた。[Domain Name]／
  [State] があれば使用中、「No match!!」なら空き、と正しく判定するようにした。）
- **A domain the registry throttled or refused is no longer shown as "likely
  free".** In a gTLD sweep the shared RDAP servers — Identity Digital most of all,
  which serves 100+ endings from one host and rate-limits this server outright —
  answer HTTP 429/403; those were marked △ "likely free (registry unreachable)",
  which is misleadingly optimistic. They are now honestly "?" ("could not check"),
  and a group that answers 429/403 is dropped at once so the rest of its endings
  are marked quickly instead of each waiting out a doomed retry.
  （レジストリに制限・拒否された結果を「空きの可能性」と表示しない。gTLD一括照会では
  共有RDAP（特に Identity Digital。1台で100以上の語尾を担当し当サーバーを丸ごと制限）が
  HTTP 429/403 を返すが、これを△「空きの可能性」と楽観的に表示していた。正直に「?（判定不能／
  確認できず）」とし、429/403 を返したグループは即座に打ち切って残りを素早く判定するようにした。）
- **Port scan no longer fails on a /16 (or larger) network.** The host-count
  limit that guards the address-by-address sweep was also applied in ARP-table
  mode, where there is no sweep — only the neighbour table (at most ~1024 entries)
  is touched — so "Port scan" on a common /16 LAN (65 536 addresses) was rejected
  with "Scan target exceeds the configured limit". The limit is now enforced only
  when a sweep will actually run.
  （/16 以上のネットワークでポートスキャンが失敗する不具合を修正。総当たり探索を守る
  ホスト数上限を、探索を行わないARPテーブルのみモード（近傍テーブル≒最大1024件しか触らない）
  にも適用していたため、よくある /16 のLAN（65,536アドレス）で「上限超過」で弾かれていた。
  実際に総当たりを行うときだけ上限を判定するようにした。）
- **A port-scan step no longer logs "Undefined variable $wait".** In
  `ScanService::stepPorts()` the port budget was computed from `$wait` before the
  variable was assigned, which logged a PHP warning on every step and, reading
  null as 0.1, over-computed the budget nine-fold. `$wait` is now set before use.
  （ポートスキャンの各ステップで `Undefined variable $wait` を記録する不具合を修正。
  `stepPorts()` で `$wait` を代入前に予算計算に使っていたため毎回PHP警告が出て、nullを0.1と
  読み予算が9倍に膨らんでいた。使用前に定義するよう是正。）
- **A free domain in the availability search no longer shows a raw "HTTP 404".**
  The diagnostic reason (e.g. RDAP's 404 that means "not registered") was printed
  next to the ○ mark; it is now kept only as the mark's tooltip, and the visible
  reason is shown only for the uncertain cases (△ / ?).
  （空きドメイン検索で、空き（○）の行に内部的な「HTTP 404」が出る不具合を修正。判定理由
  （例：未登録を意味するRDAPの404）は○の吹き出しにのみ残し、本文の理由表示は不確定
  （△／?）の場合だけに限定した。）
- **A slow or unreachable device no longer floods the admin log with errors.**
  The device-view proxy logged every connection timeout, TLS failure or refused
  connection at error level; these are ordinary outcomes for a network tool and
  are now logged at info (the browser is still shown a problem page).
  （応答の遅い・届かない機器で管理ログがエラーで溢れる問題を解消。機器ビューのプロキシが
  接続タイムアウト・TLS失敗・接続拒否をすべてエラー級で記録していたが、ネットワークツールに
  とっては通常の結果のため info 級に格下げした（ブラウザには従来どおり問題ページを表示）。）
- **The DNS tool no longer fails a whole lookup when CAA is included.** CAA was
  passed to `dns_get_record()` as the wire type number 257, which PHP 8 rejects
  with a `ValueError` that the `@` operator does not suppress, so a query with CAA
  ticked errored out entirely. CAA now uses the `DNS_CAA` constant.
  （DNS調査でCAAを含めると照会全体がエラーになる不具合を修正。CAAを `dns_get_record()` に
  型番号257で渡していたため、PHP8が `ValueError` を投げ（`@`でも抑制されない）、CAA選択時に
  照会全体が落ちていた。CAAを `DNS_CAA` 定数に修正した。）
- **A notice no longer lingers on another tab or over a new scan.** The message
  bar was shared across the whole app and never cleared, so "scan finished" sat on
  the Whois and DNS tabs and over the next scan's progress, making a running scan
  look finished. A notice is now cleared when you switch tabs and when a new scan
  starts, and an informational notice fades on its own; the progress bar shows
  only while a scan is running.
  （通知が別タブや次のスキャンに残る不具合を修正。メッセージ帯が全画面共有で消えないため、
  「調査完了」がWhoisやDNSタブ、次のスキャンの進捗の上に残り、実行中なのに完了に見えていた。
  タブ切替時とスキャン開始時に通知を消し、情報通知は自動で消えるようにした。進捗バーはスキャン中のみ
  表示する。）
- **The same address no longer appears on more than one row.** A device whose MAC
  changes (a privacy address that rotates, or a lease handed to another machine)
  left a second row for the same IP. Duplicate rows are now folded into one, both
  as they are found and once at the start of every scan.
  （同じIPアドレスが一覧に複数行出る不具合を修正。MACが変わる機器（ランダム化MACの変更や、
  リースが別機に渡った場合）で同一IPの行が二重にできていた。重複行は、検出時とスキャン開始時の
  両方で1行に統合するようにした。）
- **A name no longer follows an address to a different device.** When an address
  was handed to another machine (an old PC's lease going to an Alexa), the old
  device's name could show on the new one. A name, type and ports are now kept
  only for the same device, never carried to a different MAC that later holds the
  same address.
  （アドレスが別の機器に再割り当てされたとき、旧機器の名前が新機器に残る不具合を修正。
  旧PCのリースがAlexaに渡った等の場合に旧名が表示されていた。名前・種別・ポートは同一機器に対して
  のみ保持し、同じアドレスを後から持つ別MACには引き継がないようにした。）
- **"This server" is shown on every one of the server's own addresses.** When one
  network card holds several addresses (here 10.0.0.1 and 192.168.1.250 on the
  same card), keying them by the shared MAC let only the last one keep the badge.
  Each of the server's addresses is now its own row and each is marked.
  （サーバー自身の各アドレスすべてに「このサーバー」を表示するようにした。1枚のNICが複数の
  アドレスを持つ場合（同一NICの10.0.0.1と192.168.1.250）、共有MACをキーにしていたため最後の
  1つしかバッジが付かなかった。各アドレスを独立した行にし、それぞれに印を付けるようにした。）

## 0.4.4 — 2026-09-09

### Fixed

- **The "another network" badge no longer shows as a solid black box on a dark
  theme.** It took its colour from the host's `--color-warning`, which NetBase
  does not define, so it inherited Nextcloud's — a dark colour on a dark theme —
  and its fixed dark text was lost inside it. It now uses its own amber, readable
  on any theme.
  （「別ネットワーク」バッジがダークテーマで真っ黒な箱になっていた不具合を修正。背景に
  NetBase 未定義の `--color-warning` を使っていたため Nextcloud 側の暗い色を継ぎ、固定の
  暗い文字と重なって潰れていた。自前のアンバー配色にして、どのテーマでも読めるようにした。）

## 0.4.3 — 2026-09-09

### Fixed

- **A device page whose text is written by its own script no longer loses that
  text in a device window.** Some router and printer pages (an ASUS router's WAN
  page among them) build their labels in JavaScript, from strings that contain a
  small piece of HTML with `target="_top"` inside. The rewrite that keeps such
  links inside the window was reaching into those strings and breaking the script,
  so the page came up with its text missing. That rewrite is now applied only to
  real HTML attributes and never inside a `<script>`, so the page's own script
  runs untouched and all of its text appears.
  （機器ページが自身のスクリプトで文言を書き込む場合に、機器ウィンドウで文言が消えていた不具合を
  修正。ASUS ルーターの WAN ページ等は JavaScript の文字列内に `target="_top"` を含む HTML 断片を
  持ち、フレーム内に留めるための書き換えがその文字列を壊してスクリプトが止まっていた。書き換えを
  「本物の HTML 属性」だけに限定し `<script>` 内には一切触れないようにしたため、ページのスクリプトが
  そのまま動き、全ての文言が表示される。）
- **The device-window "Screenshot" now shows its result inside the window.** A
  device window is drawn above the app's own message bar, so a "Saved as…" note —
  or the reason a picture could not be taken — was hidden behind the very window
  it was about, and looked like nothing had happened. The message now appears in
  the window itself.
  （機器ウィンドウの「Screenshot」の結果を、ウィンドウ内に表示するようにした。機器ウィンドウは
  アプリのメッセージ帯より前面に出るため、「保存しました」や失敗理由が対象ウィンドウの裏に隠れ、
  何も起きていないように見えていた。メッセージをウィンドウ内に出すようにした。）

## 0.4.2 — 2026-09-08

### Fixed

- **The internet speed test now works at the 100 MB setting.** speed.cloudflare.com
  rejects a download request for 100,000,000 bytes or more with HTTP 403, so "100 MB"
  (100 × 1,000,000) fetched nothing and no number appeared. The download for that
  endpoint is now capped just below the limit (99,999,999 bytes), and a refused
  download is reported as an error instead of a silent zero. The 5/25/50 MB settings
  were unaffected.
  （インターネット速度テストの「100 MB」で数字が出なかった不具合を修正した。
  speed.cloudflare.com は 100,000,000 バイト以上のダウンロード要求を HTTP 403 で拒否する
  ため、100 MB ちょうど（100×1,000,000）が失敗していた。当該エンドポイントのダウンロード量を
  上限直下（99,999,999 バイト）に丸め、拒否された場合は 0 ではなくエラー表示にした。
  5/25/50 MB は影響なし。）

## 0.4.1 — 2026-09-08

### Fixed

- **Fixed a bug where clicking outside a dialog while entering data made the dialog
  disappear and discarded what you had typed.** It affected the data-entry dialogs —
  the SSH sign-in dialog, the connection editor (new/edit a saved SSH/SFTP/FTP/SMTP
  connection, including its password and private key), and the Settings dialog:
  clicking the surrounding area no longer closes them, so nothing you were entering is
  lost; close them with the ✕, Cancel or Save controls. View-only and picker dialogs
  (system information, the file picker, the page/text preview and the device panel)
  keep closing on an outside click, since they hold nothing you can lose.
  （データ入力中にダイアログの外側をクリックすると、ダイアログが消えて入力が失われてしまうバグを
  修正した。対象＝SSHサインイン・接続の新規/編集（SSH/SFTP/FTP/SMTP。パスワードや秘密鍵を含む）・
  設定の各ダイアログ。外側クリックでは閉じなくなり、✕・キャンセル・保存で閉じる。閲覧/選択系
  （システム情報・ファイル選択・プレビュー・機器パネル）は失う入力がないため従来どおり。）

## 0.4.0 — 2026-09-07

Everything since 0.3.11, which is what the customer sites have been running,
gathered into one release.

### Added

- **A terminal, not a line at a time.** SSH had a box you typed one command
  into and a box the answer came back in, which is enough for `uptime` and no
  use for anything that draws a screen. There is now a real terminal: `top`,
  `vi` and `less` run in it, colours and cursor movement work, and it is
  resized by dragging the window. PHP cannot hold a connection open between
  requests, so the server keeps the session and streams it — what is typed goes
  up one batch at a time, and what comes back arrives as it is written.
- **A sign-in dialog for SSH.** Host, port, account, and either a password or a
  private key chosen from your own Nextcloud files. A default folder for keys
  can be set in Settings, so the picker opens where the keys are kept instead
  of at the top of the file tree.
- **A device on another network, sharing the same wire, is found and stays
  found.** A camera left on its factory 192.168.1.120, plugged into a
  10.0.0.0/16 network, was invisible: it is off the server's subnet, so nothing
  routes to it, and it cannot answer a question either — its reply goes to a
  gateway it does not have. What it does do is announce itself to the multicast
  group, which is carried at the level of the wire and arrives whatever the
  addresses say. NetBase now listens to that group continuously, in the
  background, so such a device appears without a scan and is not marked offline
  for failing to answer something it was never able to answer. Its details
  carry the one command that would put this server on its network, ready to
  copy, and a button that opens a terminal on this server to run it.
- **A device can be asked about itself**, from its details: every one of its
  65,535 ports, and which of the open ones actually serve a web page. The port
  scan opens 64 connections at a time rather than the sweep's 512, because
  older hardware drops the flood and is missed at 512; the web search asks each
  port for its front page rather than guessing from the number, and a port that
  answers becomes a link in the list from then on.
- **A right-click on a device offers the ways into it** — HTTP, HTTPS, FTP, SSH
  and Telnet — built from the ports it actually has open, with Properties at the
  bottom for the panel a left-click opens. Nothing speculative is listed: a port
  that is not open is not offered, and a web page only for a port NetBase knows
  serves one or has been shown to.
- **SSH and Telnet open in a window**, the same movable, resizable frame a
  device's web page uses, so several can stand open beside the device list at
  once. Port 22 and port 23 in the device details open one instead of changing
  tab — which used to close the device and leave nowhere to go back to.
- **Telnet can now be used, not merely diagnosed.** It had a probe that read
  the banner and warned about the plain text, and nothing that would let anyone
  type at a switch. The window signs in, sends a line, reads the answer and
  hangs up — a connection per line, because PHP cannot hold one open between
  requests, which is also why nothing is left open on the device in between.
  Option negotiation is refused throughout, so the device keeps talking without
  our pretending to be a terminal.
- **Zoom, fit and a screenshot in every device window**, and a row of buttons
  where a sentence explaining the window used to be: the device's own address,
  the page's text, and the clipboard into whichever field the cursor is in.
- **Copy buttons throughout the device details** — the whole record, or any one
  row of it.
- **Five depths for the port check** (15, 106, 1,024, the high ports 1025 to
  65535, and all 65,535) and five scan speeds, with the wait for a port to
  answer now a setting of its own, since that is the number which decides how
  long a scan takes. The high ports are where a maker hides an interface it
  would rather not advertise, such as the 22401 on a router here.

### Changed

- **The device list is two lines to a column** — name over address, MAC over
  vendor, type over open ports — so a row holds what used to need sideways
  scrolling. A device that has told nobody its name is written `- no name -`
  rather than left blank.
- **What to scan is chosen first and by name** — the whole network, or the ARP
  table only — and the options beneath are arranged as the steps they are.
- **The SSH page says which boxes belong together.** It does two jobs — looking
  at a server, which needs nothing, and working on one, which needs an account —
  and ran them together in five cards with three separate host fields. Each job
  now has a heading, Telnet sits with the work rather than the looking, and the
  host typed at the top can be carried down to the sign-in with a click, so the
  two are visibly the same machine.
- **The wait for a port to answer says what it buys.** The seconds alone meant
  nothing without having thought about what a silent port costs, and the "up to
  N per device" beside them was arithmetic nobody asked for. Now: quick and
  misses slow devices, the usual, or finds the slowest and takes longest.
- **Plainer words throughout**: the ARP table is called the ARP table, the scan
  speed is a rate rather than an adjective, and links are made only for ports
  NetBase can vouch for.

### Fixed

Ten of these came out of two cameras — five from one at a customer site, five
from one here — and every one of the ten was found the same way: by signing in
and then actually using the pages behind the sign-in, rather than checking that
the front page appeared and calling the window done. None of them is particular
to a camera; they would meet any device whose own web interface is built the
same way, and the second camera was still finding them after the first five
were fixed.

- **Device pages that would not open.** A device's redirect was arriving as a
  200 with a Location nobody acted on, which left Brother, Canon, Kyocera and
  Buffalo hardware showing nothing; four ASUS routers stepped outside their
  window through `history.pushState`; and a Buffalo LinkStation reloaded itself
  once a second for ever. Found by opening every device with port 80 or 443
  across the nine sites — 73 of them — of which 32 displayed at the start.
- **A relative address that climbs with `..` no longer eats the ticket.** On the
  device the climb stops at the root; under the proxy the root is several
  segments deeper, so `../script/inputrestriction.js` from `/login.html`
  arrived with the ticket gone and came back 403. The camera's login page then
  ran without a file it needed and threw `input_edit_restriction is not
  defined`. Climbs are now resolved against the page and clamped where the
  device would clamp them — in the markup, in scripts, and in what
  `document.write` writes.
- **A POST with no content type is no longer thrown away.** Device firmware
  routinely omits it, and PHP will not parse a body it has not been told the
  shape of; taking it as a form left the device receiving an empty request. The
  camera's sign-in went 403. If nothing was parsed and something was sent, what
  was sent is what goes on.
- **Nothing but a page gets the shim.** A device also answers with things read
  by script rather than shown — the camera's sign-in returns an empty body with
  a 200 — and putting our script into that made the answer unrecognisable to
  the page that asked for it.
- **The cookies a device's own page sets now reach the device.** They live on
  this server's name alongside Nextcloud's, so Nextcloud's are left out by
  name; the session above all never leaves this origin.
- **The request says which of the device's own pages it came from.** Nextcloud
  sends `no-referrer` on everything, which is right for Nextcloud and wrong
  here: this camera turns away every page after the sign-in without it. The
  window now says same-origin — the referer never leaves this server — and the
  proxy rewrites it into the device's own address before sending it on.
- **A device window no longer sends its cookies twice.** Two sets have to go to
  the device — the session it grants at the sign-in, which the server holds and
  the browser never sees, and whatever its own page set in the browser — and
  they were being sent as two separate `Cookie:` lines. A browser never does
  that, and a small device web server reads only one of the two. This camera
  read the second, which has no session in it, decided the sign-in it had
  granted a moment earlier belonged to nobody, and answered every page after it
  with a redirect back to the login screen. Both sets now go through the same
  cookie engine and leave as the one line HTTP asks for.
- **A request with an empty body no longer arrives with one.** The parameters
  Nextcloud hands over are the query string and the body merged together, and
  taking that as the body meant the address's own question came back a second
  time as form data — `POST /action/get?subject=datetime` left here carrying
  `subject=datetime` in a body 25 bytes long. That is how this camera's pages
  ask it for their current settings, and it answered 400 to every one of them:
  the sign-in screen never offered the dialog it owes a device still on its
  factory password, and the pages behind it came up on their defaults. Only
  what was actually sent as a body is sent on as one.
- **A request with nothing to send now says how much that is.** With no body,
  curl leaves out `Content-Length` altogether; a browser always writes
  `Content-Length: 0`. Given the first, this camera's web server waits for a
  body that is never coming and eventually closes the connection with nothing
  said. Every settings page asks for its current values with exactly that kind
  of empty POST, so every page came up with its fields blank or on the first
  option in each list — the time zone reading GMT-14 when the camera was set to
  GMT+08. Measured against the device directly: no `Content-Length`, no reply
  at all; `Content-Length: 0`, the settings come back. All 27 fields on the
  Date & Time page now match what the device itself shows.
- **A file whose name has a space in it is fetched.** The browser escapes the
  space, the router unescapes it, and what reaches the proxy is a real space —
  which cannot go back into a request. Three of this camera's menu icons are
  kept under names like `Video Analytics.png`, and all three were broken
  pictures while the other eleven on the page were fine. What a path may not
  carry is escaped again on the way out, and what is already fit to send,
  the percent sign included, is left alone so that a path which was never
  unescaped is not escaped twice.
- **A port a device announced is added to what is known, not put in place of
  it.** A port scan speaks for every port it tried and may rightly take one
  away; an announcement speaks for one port only — the one the device's own
  page is on. Written down as though it were the whole truth, it erased the
  rest. This camera announces port 49152 every forty-five seconds, so a scan
  that had just found eight open ports was down to that one inside a minute,
  and the web-page search that followed had nothing left to try: it never saw
  port 80, no matter how many times the scan was run.
- **A device that answers and then stops no longer holds the window empty for
  thirty seconds.** An NTT phone system at one site sends its 403 in under a
  second and then keeps the connection open without ever finishing the body.
  A connection carrying nothing at all for ten seconds is now treated as
  finished, and the window says the device answered and then stopped rather
  than showing nothing. A stream that is genuinely working — a camera, a
  download — is carrying bytes and is never caught by this.
- **The server NetBase runs on now appears in its own device list.** A machine
  never asks the network for its own MAC address, so it is never in its own ARP
  table — and NetBase, which discovers by reading that table, could see every
  device on the network except the one it was running on. Its own interfaces
  are now written down at the start of a scan, marked "this server" in the list.
- **A device out of reach is no longer marked offline for failing to answer.**
  A scan marks everything offline and then marks back what replies, which is
  right for a device that could have replied and wrong for one that never
  could. A device that has only ever been heard announcing itself — never seen
  in the ARP table — keeps its state if it has been heard from recently.
- **A radio button is drawn as a radio button.** It had no style of its own, so
  it fell through to the rule for a text box and was rendered as one: a rounded
  rectangle with twelve pixels of padding around the dot.
- **A multicast step no longer stops without a word.** `IP_ADD_MEMBERSHIP` is
  not defined in every PHP build, and naming a constant that does not exist is
  a fatal error rather than a failed call, so the step ended silently and the
  devices that only announce themselves were never heard.
- **The standing listener actually runs.** A background job registered as
  time-insensitive is held for the maintenance window, which on an instance
  with one configured means it runs between 01:00 and 05:00 and at no other
  time — so the listener that is supposed to be hearing announcements all day
  heard none. `TIME_INSENSITIVE` is 0 and `TIME_SENSITIVE` is 1, the reverse of
  what the names suggest at a glance, and the value is written once when the
  job is first registered and never revised, so the registration has to be
  removed and remade rather than merely corrected.


## 0.3.23 — 2026-09-06

### Fixed

- **The device details fit in the panel again.** Every row of the record was as
  tall as the copy button sitting in it — 45 pixels for 20 pixels of text —
  because the button kept a full button's minimum height. Over nine rows that
  was enough to push the last of the actions below the fold.
- **The address line no longer wraps.** The name and addresses could not shrink,
  so on a narrow panel the MAC fell to a second line and left the separator
  stranded between them.

### Changed

- **A port's three ways in are on one line together.** Open in a window, render
  the page, and the plain link had been laid out as a pile, so which button
  belonged to which port was a matter of counting. The device's own actions —
  scan every port, find web pages, wake on LAN, open a typed port — are now
  separated from them by a rule.

## 0.3.22 — 2026-09-06

### Changed

- **The scan options are arranged as what they are.** The four steps of a scan
  sit on one line in the order they happen — names, multicast, ports, reverse
  DNS — and the two settings that belong to the port check sit beneath it,
  indented under the choice they modify. They had all been in a single wrapping
  row, which put an unrelated checkbox between a port setting and its own box
  whenever the window was narrow.

## 0.3.21 — 2026-09-06

### Changed

- **What to scan is now chosen first, and by name.** Two radio buttons — the
  whole network, or the ARP table only — where there had been a checkbox
  buried among the options that quietly changed what Start did. The address box
  and the scan speed belong to the first of them and appear only for it.
- **The Start button says "Start scanning"**, and sits level with the box beside
  it: the field's bottom margin and the three pixels Nextcloud gives every input
  had been holding it apart.
- **A fourth depth for the port check: the well-known ports, 1 to 1024.**
  Between the 106-port list and all 65,535, which is where most of a device's
  services actually sit.

## 0.3.20 — 2026-09-06

### Changed

- **The option is called what it does: skip the address sweep.** Reading the
  ARP table and stopping there was true to the old label but of little use — no
  names, no open ports, nothing to go on. What is worth skipping is the walk
  through every address in the network, not the work that follows it. Ticked,
  the scan starts from the ARP table and whatever announces itself, and then
  asks those devices for their names and their ports exactly as it would after
  a sweep. A device that has never spoken to this server and does not announce
  itself will not be found; everything else is, in seconds rather than minutes.

### Fixed

- **The Start button sits level with the box beside it.** The field carries a
  bottom margin meant for a stacked form, which in that row lifted the box
  twelve pixels above the button — the height of the margin.

## 0.3.19 — 2026-09-06

### Fixed

- **"Read ARP table only" now reads the ARP table only.** It had been skipping
  the address sweep and nothing else, so it went on to ask every device for its
  name over NetBIOS and mDNS, send multicast discovery, open TCP connections to
  check ports, and look up reverse DNS — seventeen seconds of probing under an
  option that says "instant", and it turned up a device that was never in the
  table at all. It now reads the kernel's table and stops. The options it makes
  meaningless — names, multicast, ports, reverse DNS, and the scan speed — are
  shown as not applying while it is ticked, and are ignored if sent anyway.

## 0.3.18 — 2026-09-06

### Changed

- **It is called the ARP table.** "Neighbour table" is the kernel's own word and
  covers IPv4 ARP and IPv6 NDP together; NetBase reads `/proc/net/arp` and the
  IPv4 limits, and nothing else, so the general word was only ever a longer way
  of saying ARP. Renamed in all twenty languages.

## 0.3.17 — 2026-09-06

### Changed

- **Reading the neighbour table is on to begin with.** A scan started without
  changing anything now answers at once, out of what this server has already
  spoken to, instead of walking the addresses. Turn it off to sweep.

## 0.3.16 — 2026-09-06

### Added

- **Scan every port**, on one device, from its details. A sweep can only give
  each device a moment; a device asked on its own can be asked about all
  65,535. It is walked in slices with the progress shown, and what is found is
  written back, so the list carries it afterwards.
- **Find web pages**, beside it. Asking is the only honest way to know which
  ports serve an interface — the number is a poor guess, since a router here
  answers on 22401 and plenty of devices have nothing on 8080. Each open port
  is asked for its front page; one that replies with a status line is a web
  page whatever its number, and its title is shown beside it with a button to
  open it. A port confirmed this way becomes a link in the list from then on,
  even though it is not one of the common ports.

## 0.3.15 — 2026-09-06

### Changed

- **Only the common ports are links in the device list.** A deeper scan turns
  up numbers whose purpose nobody knows — 22401 on a router here — and the list
  treated anything not known to be something else as a web page worth trying,
  which made most of them links that led nowhere. A number NetBase cannot vouch
  for is now printed as a number. A device page on an unusual port can still be
  opened by typing it into the device window.

## 0.3.14 — 2026-09-06

### Changed

- **The scan speed no longer carries a time estimate.** It now reads simply as
  the number of probes a second it sends, with a word on the slowest and the
  fastest about what each costs.

## 0.3.13 — 2026-09-06

### Added

- **Zoom in a device window.** Twelve steps from half size to triple, with the
  current figure between them — click it to go back to 100%. Device interfaces
  are drawn for whatever screen their maker had in mind; some are unreadable in
  a window and some waste half of it. The zoom is put on the device's own page
  rather than on the frame, so the page reflows into the same window instead of
  being scaled with it, and it is kept as the window moves from page to page.
- **Fit to window**, beside the zoom and working as a toggle. It measures what
  the page actually needs and picks the factor, then measures again on every
  page the window opens. Reaching for the step buttons takes over from it.
- **Screenshot**, which saves the page as a PNG. The picture is taken by the
  server's own headless browser pointed at the window's proxy address, not at
  the device — so it goes through the same ticket and the same stored session,
  and shows the page as it is on screen rather than the login screen.

## 0.3.12 — 2026-09-06

### Changed

- **The blue line under a device window's title is now a row of buttons.** It
  used to carry a sentence explaining the window to somebody who had already
  opened it. In its place: the device's own address onto the clipboard, the
  page's text — the selection if there is one, the whole page if not — and the
  clipboard the other way, into whichever field the cursor is in. A device
  password is nearly always pasted rather than typed, and a serial number on a
  device page is otherwise copied out by hand.

## 0.3.11 — 2026-09-06

### Fixed

- **A device page could quietly step outside its window.** Three ways, all found
  by opening every device with port 80 or 443 across nine customer sites:
  `history.pushState` was handed the device's own path with the proxy's prefix
  stripped off, which moves the address without navigating — an ASUS router
  does this on its login page, and the window ended up pointing at Nextcloud's
  root; a script assigning to `location.href` was not corrected, because that
  property cannot be hooked at run time, so the assignment now goes through an
  object that can put the address right first; and as a last resort the window
  itself notices a frame that has left the proxy's path and sends it back,
  giving up after twice so a page that insists cannot bounce for ever.

### Added

- **Five scan speeds instead of two**: 200, 500, 1,500, 5,000 and 15,000 probes
  a second, each shown with the time it will take for the addresses entered.
  The ends of the list say what they cost — the slowest is the one that misses
  nothing, the fastest misses devices — because the speed is an accuracy
  setting as much as a pacing one: on a /16 with ten devices, 15,000 a second
  found six of them and 1,500 found all ten. The default is unchanged.
- **Copy buttons in the device details.** One for the whole record, laid out as
  aligned lines to paste into a ticket or a stock list, and one on every row —
  address, MAC, vendor, reported name, workgroup, open ports, how it was found,
  first and last seen, mDNS, reverse DNS, SSDP — because a single value is what
  usually needs quoting.

## 0.3.10 — 2026-09-06

### Fixed

- **A device that answers with a redirect now opens instead of showing nothing.**
  Its status was lost on the way out: Nextcloud sends "HTTP/1.1 200 OK" for the
  response before the proxy is ever asked what the device said, and under
  FastCGI that status line is what counts — so a 301 or 302 reached the browser
  as a 200 carrying a Location nobody acted on, and the window stayed blank.
  Found across the customer fleet on Brother, Canon, Kyocera and Buffalo
  hardware, all of which redirect off their own front page. The buffered path
  now sends the status line as well as the code, which the streaming path had
  been doing all along.
- **The scan speed is called the scan speed again.** It had been renamed to the
  send rate, which was not what was asked for.

## 0.3.9 — 2026-09-05

### Fixed

- **A device window no longer reloads itself for ever.** A Buffalo LinkStation
  (LS520D724) opened on port 80 reloaded about once a second and never showed
  its login page. Its own script checks that it is at its own path and, seeing
  the proxy's prefix in front of it, redirects to where it already is — which
  fails the same check on arrival. Device firmware is written on the assumption
  that it is the whole page, so it is now told what it expects to hear: the
  path with the prefix taken off, and `window.top` pointing at the device's own
  document rather than at NetBase. `window.top.setLang is not a function`, which
  this device threw on every load, is gone with it. As a last resort, a page
  that arrives at the address it is already showing three times inside ten
  seconds is not sent there a fourth; a device that refreshes itself on a timer
  is doing something reasonable and is left alone.

## 0.3.8 — 2026-09-05

### Added

- **A third depth for the port check: every port.** All 65,535, for the device
  whose interface its maker put on 30443. It is walked across as many requests
  as it takes, so no single step overruns, and it reports its progress in ports
  rather than in devices — a count of devices would not move for minutes.
- **The wait for a port to answer is now a setting**, offered as 0.3, 0.9 or
  2 seconds with what each costs on the worst device the scan can meet. It was
  fixed at 0.9 s and invisible, which was the wrong thing to hide: this is the
  number that decides how long a scan takes. A port that refuses answers
  instantly whatever it is set to; the wait is only ever spent on a port that
  says nothing, which is what a firewall and a sleeping device both look like.

### Fixed

- **The progress bar no longer says 100% while the scan is still working.** It
  counted addresses, which are finished long before the devices found at them
  are; with the whole port range selected it sat at 100% for minutes. It now
  follows whatever phase is actually running.

### Changed

- **The send rate says what it is.** It was labelled the scan speed and offered
  "fast" or "gentle" — but it sets neither the speed of the scan nor anything a
  person could picture. It is the rate the addresses are walked through, so it
  now says 1,500/s or 500/s, and the slower one is there because a wireless
  network carries broadcasts slowly.

## 0.3.7 — 2026-09-05

### Added

- **Every control in the device scan says what it does.** Hovering over the
  target field, the speed, or any of the options now explains it in a sentence.
- **A page on any port.** A device's own interface is not always on a port the
  scan noticed, so the number can now simply be typed — with HTTP or HTTPS
  beside it, filled in from the port where the port says which — and the page
  opens through this server like any other device window.

### Changed

- **The scan speed is given in seconds, not adjectives.** "Fast" and "gentle"
  described nothing on their own. The control is now called the scan speed and
  each choice carries the time it will take for the addresses actually
  entered — read from the server's own pacing, so the figure cannot drift away
  from what the scan really does.

## 0.3.6 — 2026-09-05

### Changed

- **Plainer Japanese in the device scan.** The translation used 掃引, a word
  almost nobody says out loud, where it only ever meant "look at every address
  in turn"; it now says so in ordinary words. The pace control said 高速 and
  ひかえめ, which describe nothing on their own — it is now 調べ方 with 速さ優先
  and 負荷を抑える, so the choice explains itself.

## 0.3.5 — 2026-09-05

### Added

- **A choice of depth for the port check in device discovery.** The sweep can
  now be told to look at either the common ports — the short list of fifteen
  that tells a printer from a camera without slowing the scan — or to run a
  detailed search across 106 TCP ports: web and management interfaces, remote
  access, file, mail and directory service, databases, printers, cameras and
  the ports appliances tend to sit on. The short list stays the default, and
  the detailed search takes fewer hosts per slice so each step still finishes
  inside its time budget.

## 0.3.4 — 2026-09-05

### Fixed

- **The package is now signed.** Releases up to 0.3.3 shipped without
  `appinfo/signature.json`, so Nextcloud could not verify the app and reported
  "App signature not found, skipping app integrity check" on every server. The
  release is now signed with the app's certificate and verifies cleanly. No app
  code has changed.

## 0.3.3 — 2026-09-04

### Removed
- **Ping, traceroute, the port check, TCP ping and path MTU discovery**, and the **nmap** front end with them. The Nextcloud app store review takes the view that an app which sends probes of that kind should not be installable from the store, and NetBase follows it: the tools, their tabs, their routes and the code behind them are gone from this release.

### Changed
- Everything else works as before: device discovery and the device windows, the LAN sweep and inventory, DNS, whois, TLS and HTTP, subnet and MAC, mail, FTP and SFTP, SSH and Telnet, the clock check, the benchmarks and the server view.
- The requirements page and the administration settings no longer mention `ping`, `traceroute`, `mtr` or `nmap`, and no longer ask for them to be installed.

## 0.2.0 — 2026-08-23

### Added
- **Device windows**: a web port in the device list opens that device's own interface in a window inside NetBase, fetched through the server. A link to a local address is useless from anywhere else; this is not a link but the page itself, delivered by the server that can reach it. Several windows can be open at once, and each can be moved, resized, reloaded or made to fill the screen.
  - The window is authorised by a signed ticket that names the address, the person and an expiry, so the page needs no access to Nextcloud to be shown — and, kept at arm's length like that, cannot act as the signed-in user.
  - Only addresses on this server's own networks, or hosts a scan has actually seen, can be opened. NetBase is a network tool, not an open proxy.
  - Addresses inside the page — links, stylesheets, scripts, forms, redirects, meta refreshes and the ones its own scripts build while it runs — are pointed back through the server, and the page's character set is preserved, so Japanese device interfaces read correctly.
  - A device interface built out of frames works like the device means it to: its menu fills the frame it names, `<base target>` included, and its "replace everything" links fill the window. A sandboxed page may navigate only itself, so the window's own document does the navigating on behalf of whichever frame asked.
  - A line under the window's title says whose settings page this is and that it works from anywhere — written for whoever opens the window, not for whoever built it.
  - A **?** in the window's corner lists what works here and what does not, in as many words as that takes.
  - Files can be sent to a device through the window — new firmware, a saved configuration — which is one of the things people open a device's page for.
  - Anything that is not a page passes straight through as it arrives rather than being held in memory first, so a firmware image or a backup of any size downloads, a request for part of a file is answered as one, and a camera's picture stream keeps running.
  - The window carries the whole request: any method a device interface uses, a body of its own making — JSON and the rest — and the parts of the browser's request a device may care about, including what language to answer in.
  - A device that asks for a password in the older digest way is answered too, not only the plain way.
  - An address the page builds for itself while it runs, a redirect to another device, and a link to one, all stay inside NetBase — a second device gets a window's worth of ticket of its own.
  - A device interface is opened on whatever port it sits on, not only the familiar ones. Ports that answer something other than a web page are left alone.
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

## 0.3.2 — 2026-08-25

### Changed
- **NetBase works on a phone.** The tool list slides in from a button beside the title instead of standing beside the work; every row of fields stacks rather than being squeezed; a wide table keeps all its columns and slides sideways to show them; and the device list shows the name, address and open ports, with the rest a tap away in the panel that already holds it.
- A device's own settings page fills a phone's screen, below Nextcloud's header, so both the page and the way back stay in reach.
- The window's controls — back, front page, reload, fill the screen, help, close — are drawn rather than borrowed from whatever arrows and crosses the font happens to carry, so they have the same weight on every system.
- Panels and dialogues start below Nextcloud's own header instead of under it, where their title and close button used to disappear.
- The administration settings fit a phone too: the tool list keeps the name and the setting side by side, and stacks them on the narrowest screens.

## 0.3.0 — 2026-08-24

### Added
- **Keeping what you found**: every tool's results can be copied to the clipboard, downloaded as a text file, or written straight into a **NetBase** folder in your own Nextcloud files — named by tool and time, never over the top of an earlier one.
- The tools in the sidebar can be dragged into whatever order you work in; Alt with the arrow keys does the same without a mouse.
- Addresses are typed as what they are. A MAC goes into six boxes, an IPv4 address into four and a prefix: a full pair or three digits moves to the next box, backspace in an empty one steps back, and pasting a whole address fills the row. Combining networks takes a row per network, with **+** and **−**. Ranges and IPv6 keep a plain text box, one tick away.
- Beside each address field is a list of what NetBase already knows — the devices it found, this server's own networks, and what was last asked about. The clock check lists sixteen public time servers, and the DNS tools list the public resolvers by name.
- Every card in the subnet tools now says what it answers, rather than showing a box and leaving you to guess.

### Changed
- The README and the store description are organised around what each part is built on and what it is for, rather than a list of features.
- The settings list gets its own dark icon, so NetBase looks like every other entry there rather than a white gap.

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
