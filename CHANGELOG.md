# Changelog

All notable changes to NetBase are documented here.

## 0.6.0 — 2026-09-14

**A bigger step than 0.4.3 → 0.5.0 was. Please read the first entry before you
update: saved connections move to RegiBase, and the ones stored before this
release are gone.**
（**0.4.3 から 0.5.0 のときよりも変更点が多い版です。更新前に最初の項目を必ずお読み
ください。保存済みの接続先は RegiBase へ移り、これまでに保存したものは消えます。**）

### Changed

- **The settings dialog is wider, its tabs sit in one row, and the tabs are
  easier to tell apart.** Four tabs in a 560-pixel dialog wrapped to two rows
  with room to spare on each; the dialog is the ordinary 660 now and they fit
  in one, sharing the width and wrapping only when the names cannot be read any
  narrower. The closed tabs were a muted grey on a near-white ground, which is
  hard to separate from the panel at a glance: the ground is darker and the
  text is the ordinary text colour. Measured rather than guessed — the text now
  sits at 12.1 against its own ground where it was 4.3, and the open and closed
  states differ by 1.21 where they differed by 1.11. Five mixes were compared
  before settling on one.
  （**設定ダイアログを広げ、タブを1段にし、開いているタブと閉じているタブを見分けやすく
  しました。** 560ピクセルの幅に4つのタブは収まらず2段に折り返していましたが、各段には
  余白がありました。通常の660ピクセルに広げ、**タブが幅を分け合って1段に収まり**、名前が
  読めなくなるときだけ折り返すようにしました。閉じているタブは**白に近い地に薄い灰色の
  文字**で、ひと目では本文と区別がつきませんでした。地を濃くし、文字を通常の文字色に
  しています。**当てずっぽうではなく実測**しました。文字と地の比は 4.3 → **12.1**、開と閉の
  地色の差は 1.11 → **1.21**。5通りの濃さを比べたうえで決めています。）

- **Acting as root now lapses on its own.** The sudo password was never stored,
  but it stayed usable for as long as the page was open — and a page left open
  on an unlocked screen is somebody else's root. It is given up after a set
  time with nothing touched: ten minutes to start with, adjustable from one to
  thirty in the settings, or never for anyone who would rather decide for
  themselves. The remaining time is shown beside the notice, and "Give up root
  now" is a button rather than a line of small print. Working in NetBase resets
  the clock; merely having the tab in front of you does not, because a tab left
  on this screen while its owner is elsewhere is the case this is for.
  （**root として操作している状態が、自動で切れるようになりました。** sudo のパスワードは
  もともとどこにも保存していませんが、**画面を開いている限り使える状態が続いて**いました。
  施錠されていない端末に開いたまま置かれた画面は、そこにいる誰にとっても root です。
  **何も操作しないまま一定時間が過ぎたら手放します**。既定は10分、設定で1〜30分から選べ、
  「自分からは手放さない」も選べます。残り時間は知らせの横に出し、「**いま root を手放す**」
  は小さな文字の一行ではなくボタンにしました。NetBase で何か操作すれば数え直しますが、
  **画面が目の前にあるだけでは数え直しません**。持ち主が席にいないままこの画面が開かれて
  いる、という場合のための仕組みだからです。）

- **A folder can be downloaded now, as one ZIP file.** Only single files could
  be brought back; a folder had to be walked into and its files fetched one at
  a time. The archive is built on this server rather than on the far end,
  because that is the only way that works everywhere: a host reached over FTP
  has no commands at all, and even among Unix servers zip is often missing —
  the test server here has tar but no zip. Nothing has to be installed on the
  server being visited. Three limits keep one request from running away: how
  deep it walks, how many files it takes, and how many bytes in total; reaching
  one stops the walk and says so, rather than quietly handing over half a
  folder.
  （**フォルダーを、1つの ZIP ファイルとしてダウンロードできるようにしました。** これまで
  取り込めるのは単体のファイルだけで、フォルダーは中へ入って1つずつ取るしかありません
  でした。書庫は**接続先ではなくこのサーバーで**組み立てます。それが唯一どこでも同じに
  動く方法だからです。FTP の相手にはそもそもコマンドがなく、Unix のサーバーでも zip は
  入っていないことが多く（この検証機も tar はあるが zip は無し）、**相手側に何も導入する
  必要がありません**。1回の要求が際限なく走らないよう、**深さ・件数・総量**の3つに上限を
  設けています。上限に達したら walk を止めてその旨をお伝えします。**黙って半分だけ渡す
  ことはしません**。）

- **"Download to my files" in the right-click menu is just "Download" now.**
  What it did was plain; the wording was not.
  （**右クリックの「自分のファイルへ取り込む」を「ダウンロード」にしました。** している
  ことは単純なのに、言い方が回りくどいものでした。フォルダーでは「ZIPでダウンロード」と
  出ます。）

- **The settings dialog is tabbed too, and the tabs take one row where they
  fit.** Four groups stacked one under another made a dialog longer than the
  screen: appearance, terminal, connections and keys, and the tool order all
  had to be scrolled past to reach the last of them. They are four tabs now,
  the same ones the connection list uses. The tabs were fixed at two to a row,
  which forced a second row even where there was width to spare; they fill the
  row and wrap only when they must.
  （**設定ダイアログもタブにし、タブは収まるなら1段にしました。** 4つの群を縦に並べて
  いたためダイアログが画面より長くなり、外観・端末・接続先と鍵・ツールの並びのうち最後の
  ものへ行くには手前の3つを通り過ぎる必要がありました。接続先リストと同じ形の4つのタブに
  しました。タブは**2つずつの2段に固定**していましたが、幅に余裕があっても2段になって
  しまうため、**収まるだけ横に並べ、入らないときだけ折り返す**ようにしました。）

- **The connection list settings are four tabs now, two to a row.** The four
  kinds were stacked one under another, which ran the dialog well past the
  bottom of the screen: the one being worked on was never wholly in view, and
  finding the right one meant scrolling through the other three. Putting them
  behind a single selector had been worse — three of the four were invisible
  and there was no telling what was set up. The tabs say both at once: which
  one is open, and which of the others still have nowhere to keep their
  connections (a dot on the tab).
  （**接続先リストの設定を、2段のタブにしました。** 4つの種別を縦に並べていたため、
  ダイアログが画面の下へ大きくはみ出し、**作業中の種別が一度に収まらず**、目的のものを
  探すのに他の3つを通り過ぎる必要がありました。かといって1つの選択欄にまとめたときは
  もっと悪く、**4つのうち3つが見えず**、何が設定済みかも分かりませんでした。タブなら
  両方が一目で分かります。いまどれを開いているかと、**残りのどれがまだ未設定か**（タブに
  点が付きます）。）

- **Fixed: reordering the tool list stopped the whole sidebar from working.**
  Dragging a tool into a new place left Settings, System information and Open a
  shell unresponsive. They were not covered by anything and had not been
  replaced — the screen had simply stopped redrawing. The list was built by a
  `<template v-for>` holding a button *and* a conditional rule, with the key on
  the template rather than on the elements: one turn of the loop produced two
  nodes or one, so once the order changed Vue could no longer match them up. It
  threw inside its own patch ("insertBefore: parameter 1 is not of type Node"),
  abandoned the update, and never drew anything again. The error did not reach
  window.onerror, which is why it survived my checks. The list is now one
  element per item, keyed on the element, and the rule between the two groups
  is drawn by the item it belongs to.
  （**不具合修正：ツールの並び替えをすると、サイドバー全体が動かなくなっていました。**
  項目をドラッグして並び替えると、「設定」「システム情報」「シェルを開く」が**押しても
  反応しなく**なります。何かに覆われていたのでも、ボタンが作り直されていたのでもなく、
  **画面の更新そのものが止まっていました**。一覧は `<template v-for>` の中にボタンと
  条件付きの区切り線を入れ、**キーを template にだけ**付けていました。繰り返し1回が
  2要素になったり1要素になったりするため、順序が変わると Vue が要素を対応づけられず、
  自身の更新処理の中で例外を投げて（`insertBefore: parameter 1 is not of type Node`）
  **更新を放棄**していました。この例外は `window.onerror` に届かないため、私の検査を
  すり抜けていました。一覧を**1項目1要素・要素にキー**を付ける形に改め、区切り線は
  その上の項目が引くようにしました。）

- **Fixed: "act as root" did nothing for a saved SSH connection.** SCP offers
  the SSH connections because it signs in the same way — but opening one still
  went through SFTP, which has no shell behind it and cannot put a command
  through sudo. So the tick was there, the password was taken, and `/root` came
  back unreadable anyway. Which protocol the screen is set to is now sent with
  every request, and SCP opens over SCP even when the connection was saved as
  SSH.
  （**不具合修正：保存済みの SSH 接続先では「root として操作する」が効いていませんでした。**
  SCP はサインインの仕方が同じなので SSH の接続先を候補に出しますが、**開くときは SFTP を
  使って**いました。SFTP の背後にはシェルが無く、sudo を通せません。そのため切り替えは
  あるのにパスワードも受け取られ、それでも `/root` は読めないままでした。**画面がどの手順に
  設定されているかを毎回の要求に添える**ようにし、SSH として保存された接続先でも SCP は
  SCP で開きます。）

- **The file list works like a file manager now.** It was a table with three
  buttons on every row, and a folder could only be entered by hitting its name
  exactly. Now: a row is selected by clicking it, a folder opens on
  double-click, and the right button offers what can be done with that row —
  open, download, copy the path, rename, change permissions, delete. The
  columns sort (folders stay above files whichever one is used), ".." walks up
  from inside the list, the owner is shown, and there is a refresh button.
  （**ファイルの一覧を、ファイル管理ソフトらしい操作にしました。** これまでは各行に
  ボタンが3つ並ぶ表で、**フォルダーは名前を正確に狙わないと開けません**でした。行は
  クリックで選択、**フォルダーはダブルクリックで開き**、**右クリックでその行にできること**
  （開く・自分のファイルへ取り込む・パスをコピー・改名・権限を変更・削除）が出ます。列は
  並べ替えられ（どの列で並べてもフォルダーが上に残ります）、一覧の中から「..」で上の階層へ
  戻れ、所有者の列と再読み込みのボタンを足しました。）

- **The master key prompt says how long the key lasts.** Where the key is asked
  for, under the box: it is held until the browser is closed, for that session
  and nothing more. Somebody typing a master key deserves to know what they are
  agreeing to before they type it, not after.
  （**マスターキーを尋ねる場所に、有効期間を明記しました。** 入力欄の下に「このマスター
  キーはブラウザーを閉じるまで有効です（このセッションのみ有効）」と出します。マスター
  キーを打つ人は、**打つ前に**何に同意しているのかを知っているべきです。）

- **Fixed: the saved list could be chosen from without the master key, and then
  would not connect.** A name and an address in RegiBase are not secret and
  read back without the key; the password and the private key are, and do not.
  So a locked list looked complete — every server there, selectable — and
  failed at the moment of use, with the key asked for only once the connection
  had already been attempted. Offering a choice that cannot be carried out is
  worse than offering none. Choosing the list now asks for the key in the place
  the list would have been — "Please enter the RegiBase master key." — on both
  the SSH screen and file transfer.
  （**不具合修正：マスターキーが無くても保存済みの一覧から選べてしまい、選んでも接続でき
  ませんでした。** RegiBase では名前やアドレスは秘密の項目ではないため鍵が無くても読め、
  パスワードや秘密鍵は読めません。そのため**一覧は完全に見え、どれでも選べるのに、使う
  段になって失敗**し、鍵を尋ねられるのは接続を試みたあとでした。**実行できない選択肢を
  差し出すのは、何も出さないより悪い**ことです。リストを選んだ時点で、一覧があった場所に
  「**RegiBaseのマスターキーを入力して下さい**」と出して先に尋ねるようにしました。SSH 画面と
  ファイル転送の両方です。）

- **SCP offers the SSH connections again.** Splitting the lists by type was
  right for storage but wrong for SCP at the screen: SCP signs in over SSH with
  the same account and the same key, so every connection saved as SSH is one
  SCP can open. With the lists split, sixteen saved servers became an empty
  list on a screen that could have opened any of them. SCP's list now offers
  the SSH connections as well. Where they are *stored* has not widened — that
  is still one collection per type.
  （**SCP のリストに SSH の接続先を再び出すようにしました。** 種別でリストを分けたのは
  保存先としては正しかったのですが、**画面の SCP については誤り**でした。SCP は SSH に
  同じアカウント・同じ鍵でサインインするため、**SSH として保存した接続先はすべて SCP で
  開けます**。リストを分けた結果、16件が保存されているのに一覧が空になり、開ける相手が
  1件も出なくなっていました。SCP の一覧には SSH の接続先も出します。**保存先が広がった
  わけではありません** ― 保存先は従来どおり種別ごとに1つです。）

- **The settings name the groups the way they were asked to be named.** They
  had been relabelled "SSH", "SCP", "FTP and SFTP" and "Mail (SMTP, IMAP,
  POP3)" — wording of my own, in which Telnet had quietly disappeared. They
  read "SSH / Telnet", "SCP", "FTP / SFTP" and "SMTP / IMAP / POP3" again.
  （**設定の群の名前を、ご指示どおりの括り方に戻しました。** 私が勝手に「SSH」「SCP」
  「FTP and SFTP」「Mail (SMTP, IMAP, POP3)」と付け替えており、**Telnet が消えて**
  いました。「SSH／Telnet」「SCP」「FTP／SFTP」「SMTP／IMAP／POP3」に戻しました。）

- **The SSH screen no longer repeats its own name.** It carried a heading
  reading "SSH and Telnet" directly under the menu entry that already says so —
  the only screen of the thirteen to do it, and the same words twice in the
  same glance. The heading is gone, and the styling that existed only for it
  went with it.
  （**SSH の画面で、自分の名前を繰り返すのをやめました。** 左のメニューに「SSH・Telnet」と
  書いてあるすぐ下に、同じ「SSH・Telnet」という見出しを置いていました。**13画面のうちこの
  画面だけ**で、同じ言葉が一目の中に二度あることになります。見出しを外し、その見出しの
  ためだけにあった体裁指定も併せて削除しました。）

- **FTP and SCP no longer share one list.** The storage was split by type, but
  the screen was not: one list offered every saved FTP, SFTP, SCP and SSH
  connection together, so a server saved for FTP was offered to SCP — a machine
  that cannot answer the protocol being asked for — and the fact that the two
  are kept in different collections was hidden. The type is chosen on the
  screen now, and it picks the list as well as the protocol: SCP shows the SCP
  list, FTP and SFTP share theirs, SSH keeps its own.
  （**FTP と SCP でリストを分けました。** 保存先は種別ごとに分けたのに、**画面のリストを
  分けていませんでした**。1つのリストに FTP・SFTP・SCP・SSH の保存済み接続先がすべて並び、
  **FTP 用に保存した相手が SCP の候補として出て**いました。その機器は求められた手順に
  応えられません。別のコレクションに保存されているという事実も隠れていました。画面で種別を
  選ぶようにし、**種別が手順とリストの両方を決める**形にしました。SCP は SCP の一覧、
  FTP と SFTP は共通の一覧、SSH は SSH の一覧です。）

- **Picking from the list no longer connects on its own.** On the file transfer
  screen, choosing a saved connection opened it there and then, while the SSH
  screen waited for the button that says so. Both wait now.
  （**リストから選んだだけでは接続しないようにしました。** ファイル転送の画面では保存済みを
  選んだ瞬間に接続していましたが、SSH 画面はボタンを押すまで待ちます。**両方とも待つ**ように
  揃えました。）

- **The menu entry is "File transfer" again.** It had been renamed to the list
  of protocols it speaks, which is not what it is for.
  （**メニューの項目名を「ファイル転送」に戻しました。** 扱える手順の名前を並べた表記に
  なっていましたが、それはこの画面が何をするためのものかを表していません。）

- **The file transfer screen now works the way the SSH screen does.** The two
  do the same job — name a server, then use it — and asked for it differently:
  the SSH screen put the choice first and everything under it in one card,
  while file transfer had the typing in one card and the choice in another
  below it, with the two buttons in the opposite order and the opposite
  default. Nothing was wrong with either on its own; having both was. File
  transfer now follows the SSH screen exactly — the same choice, in the same
  order, in one card, with the chosen connection shown back the same way.
  （**ファイル転送の画面を、SSH 画面と同じ操作に揃えました。** どちらも「相手を決めて
  使う」という同じ仕事なのに、**訊き方が違っていました**。SSH 画面は選択を先頭に置いて
  その下にすべてを1枚で収めていたのに対し、ファイル転送は手入力が上のカード、選択が下の
  カードで、**ボタンの並び順も既定も逆**でした。片方だけを見れば問題はなく、**両方ある
  ことが問題**でした。ファイル転送を SSH 画面に合わせ、同じ選択・同じ順序・1枚のカードに
  し、選んだ接続先の表示の仕方も揃えました。）

- **Where connections are kept now shows every kind at once.** Separating the
  storage by kind arrived with a selector in front of it: one kind was on
  screen and the other three were not, so there was no way to see at a glance
  what was set up and what was not — and only ever one list picker, whatever
  you were looking for. All four are listed together now, each with its own
  collection and its own field assignment, each saved on its own.
  （**接続先の保存先設定で、4つの種別すべてを同時に表示するようにしました。** 種別ごとに
  保存先を分ける機能を入れた際、その前に**種別を選ぶ欄**を置いてしまいました。画面に出るのは
  1種別だけで残り3つは見えず、**何が設定済みで何が未設定かが一目で分からない**うえ、
  リスト選択も常に1つしかありませんでした。SSH・SCP・FTP/SFTP・メールを**並べて表示**し、
  それぞれに保存先コレクションと項目の割り当てを持たせ、**個別に保存**できるようにしました。）

- **The same choice of "type it in" or "pick from the list" on both screens.**
  The file transfer screen had a card for typing and a card for the saved list
  sitting one above the other, both asking for the same server with nothing to
  say which one was in use. It is one card with the same two buttons the SSH
  screen has.
  （**ファイル転送の画面にも、SSH と同じ「手入力する／リストから選ぶ」の切り替えを付けました。**
  これまでは手入力のカードと保存済みのカードが上下に並び、**どちらを使っているのかが
  分からない**まま、同じ相手を二重に尋ねていました。1枚にまとめ、SSH 画面と同じ2つのボタンで
  切り替えます。）

- **Fixed: merging the SSH screen hid the fields you type into.** Naming the
  server became one list, and "type an address below" was the first entry in
  it. Choosing a saved connection then made the typing fields disappear with
  nothing on screen to say they could come back — so they read as deleted. It
  was worst for Telnet, which is only ever typed in and never saved, and so
  looked unreachable. How the server is named is now a choice shown as one:
  **Enter it by hand** or **Pick from the list**, always visible, always
  switchable. The typed details are kept when you go to the list and back.
  （**不具合修正：SSH 画面を1枚にまとめた際、手入力欄が隠れていました。** 相手の指定を
  1つの一覧にまとめ、「下に直接入力する」をその先頭の項目にしていました。保存済みを選ぶと
  手入力欄が消え、**戻れることが画面のどこにも書かれていない**ため、消したようにしか
  見えませんでした。とくに **Telnet は手入力しかなく保存もしない**ため、接続できないように
  見えていました。相手の指定方法を**選択として画面に出す**形に改めます。「**手入力する**」と
  「**リストから選ぶ**」を常に表示し、いつでも切り替えられます。リストへ行って戻っても、
  入力済みの内容は保たれます。）

- **A folder only root can read can now be opened over SCP.** There was no way
  to elevate at all: the listing, and every rename, delete and permission
  change with it, ran as the account that signed in, so a directory belonging
  to root came back empty — indistinguishable from an empty one. Ticking **Act
  as root** asks for the sudo password on the spot, uses it for that request,
  and keeps it nowhere: not in the settings, not in RegiBase, not on disk. It
  is held in the open page and nothing else, so reloading asks again. That is
  deliberate — a password that is never written down cannot be read out of a
  stolen database.

  **What it does not cover: downloading and uploading a file.** SCP carries the
  file itself over the very input the password would have to be typed into, so
  the two cannot share a connection. Those two actions stay unelevated and the
  far end refuses them as it always did, rather than appearing to work and
  quietly returning nothing.
  （**root しか読めないフォルダーを SCP で開けるようにしました。** これまでは昇格する
  手段が一切なく、一覧も改名・削除・権限変更も**サインインした利用者のまま**実行されて
  いました。root 所有のディレクトリは**空として返り**、本当に空の場合と見分けがつきません
  でした。「**root として操作する**」を入れるとその場で sudo のパスワードを尋ね、その
  リクエストにだけ使い、**どこにも保存しません**。設定にも RegiBase にもディスクにも
  残さず、開いている画面の中だけで保持するため、再読み込みすれば再び尋ねます。**書き残さ
  ないものは、データベースを盗まれても読み出せない**という考えによるものです。

  **対象外：ファイルのダウンロードとアップロード。** SCP はファイル本体を、パスワードを
  打ち込むべき入力そのものに流すため、両立できません。この2つは昇格せず、これまでどおり
  接続先に拒否されます。**動いたように見せて黙って何も返さない**ことはしません。）

- **"Create one for me" now builds a collection shaped for the kind you asked
  for.** It made one shape for everything, so a mailbox list arrived with a
  private key field and an SSH list with a sender address — fields nobody would
  ever fill in, on every record. There is a template per kind now: SSH and SCP
  carry the key fields, FTP and SFTP carry the password ones, and mail carries
  what a mailbox actually needs. The type field offers only the types that
  collection is for, rather than all seven. The templates belong to NetBase and
  are handed to RegiBase outright, so nothing had to be added to RegiBase to
  make them possible, and a collection built by hand still works exactly as
  well — which field means what is decided by the assignment, not by these
  names.
  （**「作ってもらう」が、選んだ種別に合った形のコレクションを作るようになりました。**
  これまでは**どの種別でも同じ1つの形**を作っていたため、メールの一覧に秘密鍵の欄が、
  SSH の一覧に差出人アドレスの欄が付いてきました。**誰も埋めない欄**が全レコードに並ぶ
  状態です。種別ごとのテンプレートを用意しました。SSH と SCP は鍵の欄を、FTP・SFTP は
  パスワードの欄を、メールはメールボックスに実際に要るものだけを持ちます。種別の欄も、
  **そのコレクションが対象とする種別だけ**を選択肢に出します。テンプレートは NetBase 側に
  あり、RegiBase へはそのまま渡すだけなので、**RegiBase に何かを追加する必要はありません**。
  手作りのコレクションがこれまでどおり使えることも変わりません。どの項目が何にあたるかは、
  これらの名前ではなく割り当てが決めるためです。）

- **Each kind of connection now has its own place in RegiBase.** One collection
  held everything, which was wrong the moment the kinds diverged: SCP reuses the
  SSH credentials, but FTP is a different account on a different machine, and
  both were being read out of the same list. SSH, SCP, FTP-and-SFTP and mail
  each name their own collection and their own field assignment now. Naming the
  same collection for several kinds is expressly allowed — SSH and SCP usually
  are the same list — so separating them costs nothing to anyone who does not
  need it. Nothing moves on upgrade: a kind that has not been given a collection
  of its own still reads the single one chosen before, so the list is unchanged
  until you separate something deliberately.
  （**接続先の種別ごとに、RegiBase の保存先を分けられるようにしました。** これまでは
  すべてを1つのコレクションに入れており、種別が食い違った時点で破綻していました。SCP は
  SSH の情報をそのまま使いますが、**FTP は別の機器の別アカウント**です。それを同じ一覧から
  読んでいました。SSH・SCP・FTP/SFTP・メールが、それぞれ自分のコレクションと項目の割り当てを
  持ちます。**複数の種別に同じコレクションを指定して構いません** ― SSH と SCP はたいてい同じ
  一覧です。更新しただけでは何も動きません。自分のコレクションをまだ持たない種別は、
  これまでの単一の設定をそのまま読むため、**意図して分けるまで一覧は変わりません**。）

- **A record that does not say what it is, is no longer assumed to be SSH.** It
  is taken as whatever the collection it was read from is for. The old
  assumption put FTP servers in the SSH list.
  （**種別が書かれていないレコードを、SSH と決めつけるのをやめました。** 読み出した
  コレクションが何のためのものかで判断します。これまではFTPの機器がSSHの一覧に並んでいました。）

- **SFTP is no longer offered as a separate kind to create.** It is not a kind
  of FTP but a subsystem of SSH, and since a saved SSH connection is opened for
  files over SFTP already, offering it separately only asked people to decide
  something that made no difference. FTP keeps its encryption choice, which is
  the question that was actually being asked. A connection saved as SFTP before
  this still works and still shows its own kind.
  （**SFTP を、新規作成の種別としては出さないようにしました。** SFTP は FTP の一種では
  なく SSH の副系統です。保存済みの SSH 接続先はすでに SFTP でファイルを開くため、別々に
  出しても**違いの無い選択を迫るだけ**でした。FTP には暗号化の選択肢が残っており、実際に
  訊きたかったのはそちらです。**これまでに SFTP として保存した接続先はそのまま動き**、
  種別も SFTP のまま表示されます。）

- **The speed test now lets you choose what to measure against.** It measured
  against M-Lab and used Cloudflare only when M-Lab could not be reached at all,
  and there was no way to ask for the other one. A network that reaches one may
  not reach the other — M-Lab needs an outbound WebSocket — and two independent
  readings of the same line are worth more than one, so both are now offered:
  *Nearest (automatic)*, *M-Lab* or *Cloudflare*. Naming one means it, rather
  than quietly measuring against the other: asking for M-Lab where no M-Lab
  server answers now says so instead of handing back Cloudflare's figure under
  M-Lab's name.
  （**速度テストで、どこと測るかを選べるようにしました。** これまでは M-Lab で測り、
  M-Lab へまったく届かないときだけ Cloudflare に落ちる作りで、**もう一方を指定する
  手段がありませんでした**。片方に届く回線がもう片方に届くとは限らず（M-Lab は外向きの
  WebSocket を必要とします）、同じ回線を独立した2つの物差しで測れるほうが確かなため、
  「最も近いところ（自動）」「M-Lab」「Cloudflare」から選べるようにしました。名指しした
  場合はその指定を守ります。M-Lab を指定して1台も応答しないときは、**Cloudflare の数値を
  M-Lab の名前で返すことはせず**、届かなかったとお伝えします。）

- **Fixed: the speed test reported someone else's latency.** When measuring
  against M-Lab, the throughput came from the M-Lab server but the latency and
  jitter shown beside it were timed against `speed.cloudflare.com` — a different
  network, a different distance. The two numbers on screen described two
  different paths. Latency is now timed against the very machine the throughput
  came from.
  （**不具合修正：速度テストの遅延が、別の相手のものになっていました。** M-Lab で測る
  とき、速度は M-Lab のサーバーから得ているのに、その横に並ぶ遅延とジッターは
  `speed.cloudflare.com` に対して計っていました。相手も距離も違うため、画面の数値が
  **別々の経路の話**になっていました。遅延も、速度を測ったのと同じ機器に対して計るよう
  にしました。）

- **A saved SSH connection can now be browsed for files.** Sixteen servers were
  saved here as SSH connections, and the file transfer panel offered none of
  them: it asked for a connection of type SFTP or SCP, and refused the rest
  with "this connection is not a file transfer connection". But it is the same
  machine, the same account and the same key — the only difference is which
  subsystem is asked for after the sign-in. An SSH connection now opens over
  SFTP, and over SCP for a server that offers a shell but no SFTP subsystem.
  （**保存済みの SSH 接続先で、そのままファイルを開けるようにしました。** ここには
  SSH 接続先が16件保存されていましたが、ファイル転送の一覧には**1件も出ません**でした。
  種別が SFTP か SCP のものしか受け付けず、それ以外は「転送用の接続ではない」と撥ねて
  いたためです。しかし同じ機器・同じアカウント・同じ鍵で、違うのはサインイン後にどの
  副系統を頼むかだけです。SSH の接続先は SFTP で開き、SFTP を持たない相手には SCP で
  開くようにしました。）

- **The speed test now asks which server is nearest, instead of being told.**
  M-Lab returns its candidates in an order worked out from the address the
  request came from — a guess about geography, and here it put Seoul ahead of
  Tokyo. A measurement to the wrong country reads as a slow line rather than a
  distant one. The nearest few are now asked directly, one timed connection
  each, and the quickest is used: it costs about half a second and replaces a
  guess with a measurement. On this server it moved the reading from 187 Mbps
  down to 427.
  （**速度テストの計測先を、言われるままではなく実測で選ぶようにしました。** M-Lab は
  接続元のアドレスから推定した順で候補を返しますが、ここでは**ソウルが東京より前**に
  来ていました。国の違う相手を測ると、遠いのではなく回線が遅いように見えます。上位数件へ
  実際に接続して所要時間を測り、最も速いものを使います。かかるのは約0.5秒で、推測を実測に
  置き換えられます。当サーバーでは下りの読みが 187 Mbps から 427 Mbps になりました。）

- **SCP can now actually be used.** The protocol was added, tested and reachable
  by the server — and by nothing else: the file transfer panel offered only SFTP
  and FTP, the list of saved connections filtered SCP out, and every label still
  read "FTP and SFTP". An SCP connection could be saved and never opened. It is
  now offered wherever SFTP is.
  （**SCP が実際に使えるようになりました。** 実装と試験は済み、サーバー側では動いて
  いましたが、**画面のどこからも選べません**でした。転送画面の選択肢は SFTP と FTP
  だけ、保存済み接続先の絞り込みは SCP を落とし、名称もすべて「FTP・SFTP」のまま。
  保存はできても開けない状態でした。SFTP が使えるところでは SCP も選べます。）

- **"Which field means what" is now "Field assignment", and the master key is
  named for what it belongs to.** A heading that describes a question rather
  than naming a thing makes the reader do the work twice. "Master key" alone
  does not say whose.
  （**「どの項目が何にあたるか」を「項目の割り当て」に、「マスターキー」を
  「RegiBase参照のためのマスターキー」に改めました。** 問いかけを見出しにすると、
  読む側が二度手間になります。「マスターキー」だけでは何の鍵か分かりません。）

- **The administration settings read better in Japanese.** "Devices — read the
  device list" had been translated as "device survey", which is not what it
  does; the two buttons that set every tool at once read as fragments; and the
  wording for scanning was inconsistent with the rest of the app.
  （**管理設定の日本語を整えました。** `Devices — read the device list` が
  「接続機器調査」と訳されていましたが、実際は一覧を見るだけです。全ツールを一括で
  切り替える2つのボタンは「すべて全利用者」のように語として立っておらず、探索まわりの
  用語も他の画面と揃っていませんでした。）

- **The settings dialog is four groups, not eleven headings.** It had grown by
  addition until the terminal's font, the shell's language and the shell's log
  sat in three separate places with the connection list wedged between them,
  and the word "language" appeared twice at the same size meaning two different
  things — the app's language and the shell's. The subjects are now *Appearance
  and language*, *Terminal (shell and SSH)*, *Connections and keys* and *The
  list of tools*, each with its own title and a rule between them, and the
  settings inside a group sit a level below it. A setting an administrator
  changes for the whole server now says so on its label, instead of looking
  like one of the reader's own.
  （**設定画面を、見出し11個の一本道から4つの束に改めました。** 追加を重ねた結果、
  端末のフォント・シェルの言語・シェルのログ記録が3か所に分かれ、その間に接続先
  リストが挟まる並びになっていました。「言語」という同じ語が同じ大きさで2か所に出て、
  一方はアプリの言語、もう一方はシェルの言語を指していました。**外観と言語／
  端末（シェルとSSH）／接続先と鍵／ツールの並び**の4束にまとめ、束ごとに見出しと
  区切りを置き、その中の項目は一段下げました。管理者がサーバー全体に対して変える
  設定には、その旨をラベルに明示しました。）

- **NetBase now carries its own copy of phpseclib 3, under its own name.**
  Nextcloud ships only phpseclib 2, which cannot read an Ed25519 or an ECDSA
  private key and has no SCP at all. Until now the newer library arrived by
  accident — another app happened to bundle it — so whether a modern key worked
  depended on whether an unrelated app was installed, and where it was not the
  failure was quiet.

  Carrying a second copy under the same name would only have moved the problem:
  one library can answer to a name in a running PHP process, so whichever app
  loaded first would decide which copy *both* apps used, and NetBase would be
  running on a version it never shipped or tested. The copy therefore lives
  under `OCA\NetBase\Vendor\phpseclib3`, which collides with nothing. NetBase
  always uses the library it ships; every other app keeps using its own,
  untouched. Nothing needs registering — Nextcloud's own autoloader finds it.
  （**phpseclib 3 を、NetBase 専用の名前で同梱するようにしました。** Nextcloud
  本体は phpseclib 2 のみで、Ed25519 や ECDSA の秘密鍵を読めず、SCP も持って
  いません。これまで新しい版は「別のアプリがたまたま同梱していた」ために使えて
  いただけで、無関係なアプリの有無で鍵が使えるかどうかが決まっていました。

  同じ名前のまま2つ目を積んでも問題は移るだけです。1つの PHP 処理の中で1つの
  名前に応えられるライブラリは1つだけで、**先に読み込まれたアプリの版が両方の
  アプリに使われます**。つまり NetBase は、同梱も試験もしていない版で動くことに
  なります。そこで `OCA\NetBase\Vendor\phpseclib3` という NetBase 専用の名前に
  改めました。衝突が起きないため、NetBase は常に自分が同梱した版で動き、他の
  アプリは自分の版のまま一切影響を受けません。登録の仕組みも不要で、Nextcloud
  本体の読み込み器がそのまま見つけます。）

- **SCP has been added to the saved connections.** A server can offer SSH
  without the SFTP subsystem, and on that machine SCP is the only way to move a
  file. SCP itself copies a named file and nothing else — no listing, no rename,
  no mkdir — so those are supplied over the shell the SSH connection already
  provides, with every argument quoted. It is offered only where this server has
  a library that can speak it.
  （**接続の種類に SCP を追加しました。** SFTP サブシステムを持たない SSH サーバーでは、
  SCP だけがファイルを送る手段になります。SCP 自体は指定したファイルを複製するだけで、
  一覧・改名・作成の機能を持たないため、それらは SSH のシェル越しに補っています（引数は
  すべて安全に括ります）。対応ライブラリがあるサーバーでのみ選択肢に現れます。）
- **Telnet is no longer a box of its own.** It was a second card asking for the
  same host and port as the one above it. The connection form now carries a type
  beside the address — SSH or Telnet — and the fields only SSH needs appear only
  for SSH.
  （**Telnet の専用枠をやめました。** すぐ上の欄と同じホストとポートを二度尋ねる作りに
  なっていました。接続フォームにアドレスと並べて種別（SSH／Telnet）を置き、SSH でしか
  使わない欄は SSH のときだけ出します。）
- **Words that explained nothing have been replaced**, and the settings screen
  reads as separate subjects again: a rule between the headings, and the long
  grey paragraphs cut to what is worth saying.
  （**意味の伝わらない言葉を入れ替え**、設定画面を読めるように整えました。「サーバーを
  調べる」→「SSHサーバーを調べる」、「サーバーを操作する」→「サーバーに接続する」、
  「接続先の保存先」→「SSH/Telnet/FTP/SFTP/SCPの接続先リスト」、「端末の記録」→
  「シェルのログ記録」。節の間に区切り線を入れ、説明文も刈り込みました。）
- **A measurement now runs for at least two seconds.** A small size could end an
  upload while the first megabytes were still sitting in the socket buffer,
  which reported the speed of the buffer rather than of the line — an upload
  came out faster than the download. The size still caps the traffic, but only
  once the measurement has had long enough to mean anything.
  （**測定は最低2秒は行うようにしました。** 小さいサイズを選ぶと、最初の数MBが送信バッファに
  入った時点で上りが終わってしまい、回線ではなくバッファの速さを報告していました（上りが
  下りより速く出る原因です）。サイズによる通信量の上限は残しつつ、意味のある長さに達する
  までは打ち切らないようにしました。）

- **Saved connections have moved into RegiBase, and the ones stored before this
  release are gone.** Please write down anything you need before updating: host,
  user name and settings can be typed again, but a password or a private key
  kept only in NetBase cannot be recovered afterwards. Nothing is migrated,
  deliberately — the old store could be read back by the server that held it,
  and carrying those secrets across would have carried that weakness with them.
  （**保存済みの接続先は RegiBase へ移行し、これまでに保存した接続先は消えます。**
  更新前に必要な情報の控えをお取りください。ホスト・ユーザー名・設定は入力し直せますが、
  NetBase にしか無いパスワードや秘密鍵は後から取り出せません。移行は意図的に行いません。
  従来の保存方式はサーバー自身が読み戻せる形だったため、そのまま持ち越すと同じ弱さを
  持ち込むことになるからです。）
- **Why the move.** A password in RegiBase is sealed in the browser with a key
  derived from a master key that is stored nowhere — not in the database, not in
  the configuration, not on disk. NetBase could not offer that on its own: its
  own store was encrypted with the instance secret, which sits on the same
  server as the data it protects. A stolen database is now a database of
  ciphertext.
  （**移行の理由**。RegiBase のパスワードはブラウザ側で封印され、その鍵はどこにも保存され
  ないマスターキーから導かれます。データベースにも設定にもディスクにも残りません。NetBase
  単独ではこれを提供できませんでした。従来はインスタンス秘密鍵で暗号化しており、それは
  守るべきデータと同じサーバー上にあるからです。データベースを盗まれても、そこにあるのは
  暗号文だけになります。）
- **RegiBase is now required in order to save a connection.** Without it, a
  server can still be reached by typing its details each time; nothing is
  stored, and nothing needs to be.
  （**接続先の保存には RegiBase が必要になりました。** 無い場合でも、毎回入力すれば接続は
  できます。その場合は何も保存されません。）
- **The collection is yours, and so is its shape.** NetBase does not demand a
  collection built to its own design: you say which field is the host, which is
  the password, and so on, and it adapts. A ready-made collection can be created
  for you if you would rather not build one. A password can only be matched to a
  field RegiBase itself treats as secret, so it can never be written in the
  clear. A public key is deliberately not treated as secret.
  （**コレクションの構成は自由です。** NetBase 専用の形を強いません。どの項目がホストで、
  どれがパスワードかを指定すれば、それに合わせます。用意されたコレクションを自動で作る
  こともできます。パスワードは RegiBase 側で秘匿とされた項目にしか割り当てられないため、
  平文で書かれることはありません。公開鍵は意図的に秘匿として扱いません。）
- **The master key is asked for once per browser session** and is forgotten when
  that session ends. It is never written down on the server.
  （**マスターキーはブラウザのセッションごとに一度だけ**尋ね、セッションが切れると失われます。
  サーバー側に書き残すことはありません。）

- **The old store for saved connections has been dropped.** 0.6.0 moved
  connections into RegiBase and said that what was kept in NetBase itself would
  not come with them; the table is now gone, and so are the passwords it still
  held. That is the point of it: they were sealed with a secret kept on the same
  server as the data.
  （**接続先の旧保存領域を削除しました。** 0.6.0 で接続先は RegiBase へ移り、NetBase 側に
  残っていたものは引き継がないとお伝えしていました。その表を削除し、そこに残っていた
  パスワードも消えました。これが目的です。旧方式はデータと同じサーバーにある鍵で
  暗号化されており、守りとして弱いものでした。）
- **Errors now speak the language you read.** Everything a tool refuses to do —
  a bad host, a file that is not there, a server that would send your password in
  the clear — was written in English wherever it was raised. It is now turned
  into your own language at the one place every error passes through, and the
  messages that carry a value (a path, a host, a byte count) were rewritten so
  the value has a place to go. All twenty languages.
  （**エラーの文言を、お使いの言語で表示するようにしました。** 不正なホスト名、存在しない
  ファイル、パスワードが平文で送られる状況など、これまで英語のまま出ていた文言を、
  すべてのエラーが通る一箇所で翻訳するようにしました。パス・ホスト名・バイト数などの値を
  含む文言は、値を差し込める形に書き直しています。20言語すべてに対応。）
- **The free-domain search now says what it found, not how it asked.** Hovering a
  result used to show "HTTP 404", which is the registry's answer, not yours. It
  now says what that means — free, taken, or why it could not be decided — and
  which registry or name server answered, with the technical reason kept on a
  second line.
  （**空きドメイン検索の説明を、意味のある文に変えました。** 結果にカーソルを合わせると
  「HTTP 404」と出ていましたが、これはレジストリ側の答えであって、お客様への答えでは
  ありません。空きか、登録済みか、なぜ判定できなかったかを述べ、どのレジストリ／
  ネームサーバーが答えたかも示します。技術的な理由は2行目に残しています。）

- **The internet speed test now measures against M-Lab** — the measurement
  behind Google's own speed test — instead of pulling from one fixed endpoint.
  It asks where the nearest measurement server is and uses that, which is the
  difference between measuring your line and measuring the distance to somebody
  else's CDN. Nothing has to be installed: the protocol is a WebSocket, and
  NetBase speaks it directly. Where M-Lab cannot be reached at all — an instance
  with no way out, or a blocked connection — the previous HTTP test still stands
  behind it, so the tool never simply stops working.
  （**回線速度の測定を M-Lab に切り替えました。** Google 自身の速度テストの実体であり、
  固定の配信元から引くのではなく、**最寄りの測定サーバーを尋ねてそこで測ります**。これは
  「自分の回線を測る」ことと「他社CDNまでの距離を測る」ことの違いです。追加の導入物は
  不要で、通信方式（WebSocket）を NetBase が自前で話します。M-Lab に到達できない環境
  （外部へ出られない・接続が塞がれている）では、従来のHTTP測定に自動で切り替わるため、
  機能が止まることはありません。）
- **The reading is presented as a guide, because that is what it is.** The figure
  moves with the server that happened to be nearest and with the time of day, so
  the panel now names the server it measured against and says so plainly.
  （**測定値は「目安」として示すようにしました。** そのときの最寄りサーバーや時間帯に
  よって値は動きます。どのサーバーで測ったかを画面に表示し、目安である旨も明記します。）
- **The size setting is now a ceiling on the traffic a run may use.** A
  measurement that runs for ten seconds on a fast line moves a great deal of
  data; on a metered connection that matters, so the chosen size stops it early.
  （**サイズ指定は「1回の測定で使う通信量の上限」になりました。** 高速回線で10秒測ると
  相応の通信量を使います。従量制の回線では無視できないため、指定したサイズで打ち切ります。）

- **The RegiBase master key is asked for when a connection is used, not in the
  settings.** It never belonged on a settings screen: a settings screen is where
  things are kept, and this is the one thing that must not be. It is now asked
  for at the moment a saved connection is needed, held for that browser session
  alone, and forgotten when the session ends. It is written nowhere — not in the
  settings, not in the database, not on disk.
  （**RegiBase のマスターキーは、設定画面ではなく接続を使う時点で尋ねるようにしました。**
  設定画面は「保存する場所」であり、マスターキーは保存してはならない唯一のものです。
  保存済み接続先が必要になった時点で入力していただき、そのブラウザのセッションの間だけ
  保持し、セッションが切れれば失われます。設定にもデータベースにもディスクにも書きません。）
- **The terminal log is a switch now, and it keeps 5,000 steps by default.** It
  was a number that started at zero, which read like a setting somebody had
  forgotten to fill in. Recording is still off until it is switched on.
  （**端末の記録はチェック式にし、既定で5,000行を保持するようにしました。** 従来は0から
  始まる数値欄で、設定し忘れのようにも見えました。記録が既定で無効である点は変わりません。）

### Added

- **A terminal can now keep a record of what was done in it.** A shell on this
  server and an SSH window are the two places in NetBase where something is done
  rather than merely looked at, and until now nothing was left afterwards to say
  what that was. One step is a line you typed together with the answer that came
  back — the answer arrives after the Return that asked for it, so the two are
  paired the way you would read them, not the way they arrive. The colours and
  cursor moves a terminal threads through its output are taken out, so what is
  kept reads as words. Two limits hold it down: a number of steps per window,
  oldest dropped first, and a number of days counted from a window's most recent
  step — so a window still in use is never cut short, and one finished with goes
  as a whole. What is kept belongs to the account that did the work: nobody else
  can read it, and it can be thrown away one session at a time or all at once.
  **Nothing is recorded until you ask for it: the number of steps starts at zero,
  and zero means keep none.**
  （【端末の記録】シェルとSSHの画面で行った操作を残せるようにしました。1ステップは、入力した
  1行と、それに返ってきた答えです。答えはEnterの後に届くため、読むときの並びで対応付けます。
  出力に混ざる色や画面制御の符号は取り除き、文字として読める形で保存します。上限は2つで、
  画面ごとの「残すステップ数」（古いものから削除）と、「残す日数」（その画面の最後の記録から
  数えます）。使用中の画面が途中で切られることはなく、日数を過ぎたものはセッションごと消えます。
  記録はその操作を行ったアカウントだけのもので、他の方は読めません。セッション単位でも一括でも
  削除できます。**初期値は「保存しない」です（ステップ数0＝何も記録しません）。**）

### Fixed

- **The "Run command" button beside a saved SSH connection did nothing.** It
  was bound to a method that did not exist — and Vue does nothing at all for a
  click bound to a method it has not got, so the button looked dead while the
  console beside it worked perfectly. The same was true of the "Run" button for
  the ready-made questions. Both now run the line and show the output, the exit
  status and how long it took.
  （**保存済み SSH 接続先の「コマンド実行」ボタンが無反応でした。** 存在しない
  メソッドに結び付けられており、Vue は未定義のメソッドへの `@click` では**何もしません**。
  そのため、隣の対話コンソールは正常に動くのにボタンだけが死んでいました。よくある質問を
  選ぶ「実行」ボタンも同じ状態でした。どちらも実行し、出力・終了状態・所要時間を表示します。）

- **After an upload, the file list did not refresh.** The file arrived — it was
  the listing that stayed behind. Upload read the folder back from the path box
  rather than from the listing itself, and the box is bound to whatever the
  reader may have typed into it, so it drifts from what is on screen. Every
  other action on that panel already read it back from the listing.
  （**アップロードの後、ファイル一覧が更新されませんでした。** ファイル自体は届いており、
  一覧だけが古いままでした。アップロード処理が、一覧そのものではなく**パス入力欄**を基準に
  読み直していたためです。入力欄は利用者が打ち込んだ値と結ばれているため、表示中の位置から
  ずれます。同じ画面の他の操作は、いずれも一覧を基準に読み直していました。）

- **whois told you nothing about a .jp domain.** Every .jp is answered by
  JPRS, which does not write `Label: value` the way most registries do. It
  writes `[Label]` and then spaces — no colon — and for an organisational
  domain it puts an index letter in front: `a. [ドメイン名]`. The Japanese
  labels had been in the patterns from the start, but every one of them
  demanded a colon that JPRS never sends, so they could not match: `.com`
  returned six or seven details and `.jp` returned none. Both of JPRS's shapes
  are now read, an organisational domain's expiry is taken from inside its
  status line (there is no separate one), and a label JPRS sends with nothing
  after it no longer becomes an empty field. The ordinary shape is untouched,
  and a test holds both to the registries' own wording.

  One line of that fix was wrong in a way worth naming. A whois server answers
  over a socket and ends its lines with CRLF; the pattern for name servers was
  anchored as if they ended with LF, so it matched nothing and a .jp domain
  came back with its dates but no name servers. The test did not catch it
  because sample text typed into a test file ends with LF alone — it passed
  while the real thing failed. The samples are sent through the same line
  endings a socket would use now, and the test fails without the fix.
  （**whois が .jp ドメインの情報を何も返していませんでした。** .jp はすべて JPRS が
  応答しますが、JPRS は多くのレジストリのような `ラベル: 値` ではなく、`[ラベル]` の
  後に**コロンを置かず空白だけ**で値を書きます。組織用ドメインでは `a. [ドメイン名]` の
  ように索引文字が前に付きます。日本語ラベルは当初から規則に書かれていたものの、
  **JPRS が送らないコロンを要求していた**ため一致しようがなく、`.com` では6〜7項目
  取れるのに `.jp` では0項目でした。JPRS の2つの書式を読めるようにし、組織用ドメインに
  固有の有効期限行が無い点は状態欄から取り、値の無いラベルを空項目にしないようにしました。
  従来の書式には手を触れていません。レジストリの実際の応答を固定データとした検査を添えて
  います。

  なお、その修正のうち1行が誤っており、書き残す価値があります。whois サーバーはソケットで
  応答し、行末は **CRLF** です。ところがネームサーバの規則は行末を LF だけと見なしていたため、
  **実物では1件も一致しませんでした**。日付は取れるのにネームサーバだけが空、という形です。
  検査ファイルに書いた文字列の行末は LF のみなので、**検査は合格したまま実物が失敗**して
  いました。固定データをソケットと同じ行末に通すよう改め、修正前の規則では 0 件・修正後は
  2 件になることを確かめたうえで残しています。)

- **Choosing Telnet left the port at 22.** Two methods in the same object had
  the same name. That is not an error in JavaScript — the second simply
  replaces the first — so picking Telnet ran the file-transfer panel's version,
  which set a port on a different form, and the port beside the Telnet choice
  never moved off 22.
  （**Telnet を選んでもポートが22のままでした。** 同じオブジェクトの中に同名の
  メソッドが2つあり、JavaScript では後の定義が前を置き換えます。そのため Telnet を
  選ぶとファイル転送側の処理が走り、別の入力欄のポートを書き換えていました。）

- **Entering the master key did nothing.** Saving where connections are kept
  needs the key, so it was asked for — and then the save was never retried. The
  key was accepted, the dialog closed, and the setting was unchanged, which
  from the outside is indistinguishable from the key being refused. What was
  being attempted is now remembered and carried out once the key is given. The
  settings dialog also has a box to type the key into: it had the code for one
  but no field, so the only way to be asked was to press Save and fail.
  （**マスターキーを入れても設定が保存されませんでした。** 保存には鍵が必要なので
  尋ねてはいたものの、**解錠後に保存をやり直していません**でした。鍵は通り、画面は
  閉じ、設定は変わらない——外から見れば鍵を拒否されたのと区別がつきません。何をしよう
  としていたかを覚えておき、鍵が入った時点で実行するようにしました。あわせて設定画面
  に鍵の入力欄を置きました（処理は書かれていたのに入力欄が無く、保存して失敗する以外に
  尋ねられる道がありませんでした）。）

- **The master key prompt appeared behind the dialog that asked for it.** Both
  were on the same stacking layer, and where two things share a layer the one
  written later in the page wins.
  （**マスターキーの入力画面が、それを求めた画面の後ろに隠れていました。** 同じ
  重なりの層に置かれており、層が同じときは後に書かれた方が上になるためです。）

- **Japanese: the settings dialog said something the English never did.** Its
  subtitle had been translated as "switches NetBase's *appearance* only", but
  the dialog holds the shell log, the connection list, the SSH key folder and
  the tool order, and the English says nothing about appearance. Checked across
  all twenty languages; Japanese was the only one that had drifted. Also
  corrected in Japanese: "follow the server" read as an order rather than a
  choice, the tool list called the tools "features" in its body and "tools" in
  its heading, and folder, browser and sign-in were each spelled two ways.
  （**日本語：設定画面に、英語原文にないことが書かれていました。** 副題が「NetBase
  の**見た目だけ**を切り替えます」と訳されていましたが、この画面にはシェルのログ記録・
  接続先リスト・SSH鍵の置き場所・ツールの並びまで含まれ、英語原文は見た目とは
  言っていません。20言語すべてを確認し、ずれていたのは日本語だけでした。あわせて、
  「サーバーに従う」という硬い言い回し、見出しは「ツール」なのに本文は「機能」と
  なっていた不統一、フォルダ／フォルダー・ブラウザ／ブラウザーなどの表記ゆれも
  直しました。）

- **SCP: a file's permissions were read too small, and a name with a space in
  it lost its first word.** SCP has no directory listing of its own, so one is
  read by running `ls -la` over the shell. Two mistakes were in taking that
  reply apart: the letters r, w and x already carry their own weight and were
  being shifted by their position as well, so 0640 came back as 0600; and the
  timestamp was matched by a greedy pattern that swallowed the beginning of a
  name like "report 2026.txt". Both are now covered by a test that needs no
  server.
  （**SCP で、ファイルの権限が実際より小さく読まれ、空白を含む名前が先頭の語を
  失っていました。** SCP には一覧の機能が無いため `ls -la` の出力を解いていますが、
  その解き方に2つの誤りがありました。r・w・x は既に桁の重みを持っているのに位置で
  さらに桁をずらしていたため 0640 が 0600 になり、また時刻の照合が貪欲だったため
  「report 2026.txt」のような名前の先頭が飲み込まれていました。どちらもサーバー
  不要の検査で押さえました。）

- **Number boxes were as wide as the panel** for a value of one to four digits,
  and the list that matches a collection's fields ran down the dialog one row at
  a time. Both are now the size of what goes in them.
  （**数値の入力欄が、1〜4桁の値に対して画面幅いっぱい**になっていた点と、コレクションの
  項目の割り当てが1行ずつ縦に延びていた点を整えました。）

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
