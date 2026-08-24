<?php
/**
 * A pretend device web interface, built out of everything that makes real
 * ones awkward: EUC-JP with no charset header, root-relative assets, links
 * aimed at the whole browser, a login that redirects and sets a cookie, a
 * frameset, scripts that write more scripts, XHR, and HTTP authentication.
 *
 * Run: php -S 127.0.0.1:8080 router.php
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$euc = fn (string $text) => mb_convert_encoding($text, 'EUC-JP', 'UTF-8');

$page = function (string $title, string $body, bool $eucjp = true) use ($euc) {
	$html = '<!DOCTYPE html><html><head><title>' . $title . '</title>'
		. '<meta http-equiv="content-type" content="text/html; charset=' . ($eucjp ? 'EUC-JP' : 'UTF-8') . '">'
		. '<link rel="stylesheet" href="/style.css">'
		. '<script src="/app.js"></script>'
		. '</head><body><h1>' . $title . '</h1>' . $body
		. '<img src="/logo.png" alt="logo" width="48"><div id="xhr">XHR: …</div>'
		. '<div id="late">late.js: …</div></body></html>';
	header('Content-Type: text/html');   // deliberately no charset
	echo $eucjp ? $euc($html) : $html;
};

switch ($path) {
	case '/':
		$page('テスト機器 ステータス',
			'<p>この文字が読めれば文字コードは正しい。</p>'
			. '<ul>'
			. '<li><a href="/inner" target="_top">全画面を狙うリンク（_top）</a></li>'
			. '<li><a href="/inner" target="_parent">親を狙うリンク（_parent）</a></li>'
			. '<li><a href="/inner">ふつうのリンク</a></li>'
			. '<li><a href="/deep/page">深い階層のページ</a></li>'
			. '<li><a href="/frames">フレーム構成のページ</a></li>'
			. '<li><a href="/secret">認証が要るページ</a></li>'
			. '</ul>'
			. '<form method="post" action="/login">'
			. '<input name="user" value="admin"><input type="password" name="pass" value="secret">'
			. '<button type="submit">ログイン</button></form>');
		return;

	case '/inner':
		$page('内部ページ', '<p>ウィンドウの中にとどまっていれば成功。</p><p><a href="/">戻る</a></p>');
		return;

	case '/deep/page':
		$page('深い階層', '<p><a href="sub">同じ階層へ</a> / <a href="../">ひとつ上へ</a></p>');
		return;

	case '/deep/sub':
		$page('深い階層のとなり', '<p>相対リンクが正しく解決された。</p>');
		return;

	case '/login':
		setcookie('session', 'signed-in-' . substr(md5((string)time()), 0, 6), 0, '/');
		header('Location: /dashboard', true, 302);
		return;

	case '/dashboard':
		$page('ログイン後', '<p>Cookie: <b>' . htmlspecialchars($_COOKIE['session'] ?? '（ない）') . '</b></p>'
			. '<p><a href="/" target="_top">最初へ（_top）</a></p>');
		return;

	case '/frames':
		header('Content-Type: text/html');
		echo '<html><head><title>フレーム</title></head>'
			. '<frameset cols="200,*"><frame name="menu" src="/frame-menu"><frame name="main" src="/frame-main"></frameset></html>';
		return;

	case '/frame-menu':
		// The menu says nothing about where its links open: the <base> does,
		// which is how plenty of device interfaces are built.
		header('Content-Type: text/html');
		echo '<html><head><base target="main"><title>メニュー枠</title></head><body>'
			. '<h1>メニュー枠</h1>'
			. '<p><a href="/frame-swapped">本文を差し替え（base target 頼み）</a></p>'
			. '<p><a href="/frame-swapped" target="main">本文を差し替え（明示）</a></p>'
			. '</body></html>';
		return;

	case '/frame-main':
		$page('本文枠', '<p>フレームが読み込めている。</p>', false);
		return;

	case '/frame-swapped':
		$page('差し替え後の本文', '<p>メニューからの指定が正しい枠に届いた。</p>', false);
		return;

	case '/secret':
		$expected = 'Basic ' . base64_encode('admin:secret');
		if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== $expected) {
			header('WWW-Authenticate: Basic realm="Test rig"');
			http_response_code(401);
			echo '<html><body>401</body></html>';
			return;
		}
		$page('認証が通った', '<p>Authorization ヘッダーが届いている。</p>', false);
		return;

	case '/upload':
		$name = $_FILES['blob']['name'] ?? '(none)';
		$size = (int)($_FILES['blob']['size'] ?? 0);
		$note = (string)($_POST['note'] ?? '');
		$page('受け取ったファイル', '<p>名前: <b>' . htmlspecialchars($name) . '</b></p>'
			. '<p>大きさ: <b>' . $size . '</b> バイト</p>'
			. '<p>メモ: <b>' . htmlspecialchars($note) . '</b></p>', false);
		return;

	case '/upload-form':
		$page('ファイル送信', '<form method="post" action="/upload" enctype="multipart/form-data">'
			. '<input type="file" name="blob"><input name="note" value="ファーム更新">'
			. '<button type="submit">送信</button></form>', false);
		return;

	case '/big':
		// A firmware image: too large to hold in memory, sent in pieces, and
		// able to answer a request for part of it.
		$total = 30 * 1024 * 1024;
		$from = 0;
		$to = $total - 1;
		$partial = false;
		if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'] ?? '', $m) === 1) {
			$from = $m[1] === '' ? 0 : (int)$m[1];
			$to = $m[2] === '' ? $total - 1 : (int)$m[2];
			$partial = true;
		}
		$length = $to - $from + 1;
		header('Content-Type: application/octet-stream');
		header('Accept-Ranges: bytes');
		header('Content-Disposition: attachment; filename="firmware.bin"');
		header('Content-Length: ' . $length);
		if ($partial) {
			http_response_code(206);
			header("Content-Range: bytes $from-$to/$total");
		}
		$chunk = str_repeat('N', 65536);
		$sent = 0;
		while ($sent < $length) {
			$piece = min(strlen($chunk), $length - $sent);
			echo substr($chunk, 0, $piece);
			$sent += $piece;
			flush();
		}
		return;

	case '/echo':
		// Whatever the page sent, described back: method, type and body.
		header('Content-Type: application/json');
		echo json_encode([
			'method' => $_SERVER['REQUEST_METHOD'],
			'type' => $_SERVER['CONTENT_TYPE'] ?? '',
			'body' => file_get_contents('php://input'),
			'range' => $_SERVER['HTTP_RANGE'] ?? '',
			'language' => $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '',
		]);
		return;

	case '/style.css':
		header('Content-Type: text/css');
		echo "body{font-family:sans-serif;padding:20px;background:#eef}h1{color:#036}"
			. "body{background-image:url(/dot.png);background-repeat:no-repeat;background-position:right top}";
		return;

	case '/app.js':
		header('Content-Type: application/javascript');
		// document.write of another script, an XHR, and an image src set in code
		echo "document.write('<script src=\"/late.js\"><\\/script>');\n"
			. "window.addEventListener('DOMContentLoaded', function () {\n"
			. "  var x = new XMLHttpRequest();\n"
			. "  x.open('GET', '/api/status');\n"
			. "  x.onload = function () { document.getElementById('xhr').textContent = 'XHR: ' + x.responseText; };\n"
			. "  x.send();\n"
			. "  fetch('/api/status').then(function (r) { return r.text(); }).then(function (t) {\n"
			. "    document.getElementById('xhr').textContent += ' | fetch: ' + t; });\n"
			. "});\n";
		return;

	case '/late.js':
		header('Content-Type: application/javascript');
		echo "window.addEventListener('DOMContentLoaded', function () {\n"
			. "  document.getElementById('late').textContent = 'late.js: 読み込めた';\n"
			. "});\n";
		return;

	case '/api/status':
		header('Content-Type: text/plain');
		echo 'ok';
		return;

	case '/logo.png':
	case '/dot.png':
		header('Content-Type: image/png');
		echo base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoU2NkYGD4z0AEYBxVSFJgYBgNHOoEDgAlGgQBc0Xt4gAAAABJRU5ErkJggg==');
		return;

	default:
		http_response_code(404);
		echo '<html><body>404</body></html>';
}
