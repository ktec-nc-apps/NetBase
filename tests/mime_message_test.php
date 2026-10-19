<?php
/**
 * Regression test: reading mail the way a mail program does (MimeMessage, MailService::mailDate).
 *
 * The four messages below are the ones the mail reader was checked with on a
 * real Dovecot (2026-10-18): an ISO-2022-JP subject cut across two encoded
 * words in the middle of an escape sequence, a Shift_JIS quoted-printable body
 * with a line that starts with a dot, an HTML message with a cid: picture and
 * an attachment whose Japanese name is given the RFC 2231 way, and an old
 * program's raw Shift_JIS header with no encoding at all.
 *
 * The date check pins a PHP quirk: strtotime("Fri, 17 Oct 2026") is the
 * Friday on or after 17 October, so a Date header with the wrong weekday was
 * shown up to six days late.
 *
 * Run: php tests/mime_message_test.php
 */
namespace OCP { interface IL10N {} }
namespace Psr\Log { if (!interface_exists(LoggerInterface::class)) { interface LoggerInterface {} } }
namespace {
require __DIR__ . '/../lib/Service/MimeMessage.php';
use OCA\NetBase\Service\MimeMessage;

$mail = [
	'1' => 'RnJvbTogPT9JU08tMjAyMi1KUD9CP0d5UkNPalJHSXhzb1FnPT0/PSA8c2F0b0BleGFtcGxlLmpwPg0KVG86IG5idXNlckBleGFtcGxlLmpwDQpTdWJqZWN0OiA9P0lTTy0yMDIyLUpQP0I/R3lSQ01uRTFSQ1JPTlVRN2RrOC9KRXNrUkNRaz89DQogPT9JU08tMjAyMi1KUD9CP0pFWWhTak5PUnlja1RpUXFOR29rSkNGTEd5aEM/PQ0KRGF0ZTogRnJpLCAxNyBPY3QgMjAyNiAwOTowMDowMCArMDkwMA0KTWVzc2FnZS1JRDogPG0xQGV4YW1wbGUuanA+DQpNSU1FLVZlcnNpb246IDEuMA0KQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PUlTTy0yMDIyLUpQDQpDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nOiA3Yml0DQoNChskQjszRURNTRsoQg0KDQobJEI1RDt2Tz8kckU6SVUkNyReJDkhIxsoQj8bJEIkSBsoQj8bJEIkYkZ+JEMkRiQkJF4kOSEjGyhCDQo=',
	'2' => 'RnJvbTogc3V6dWtpQGV4YW1wbGUuanANClRvOiBuYnVzZXJAZXhhbXBsZS5qcA0KU3ViamVjdDogPT9TaGlmdF9KSVM/UT89ODI9QTg9OEM9QTk9OTA9Q0Y9ODI9RTA9ODI9RTg9ODI9Q0M9OEM9OEY/PQ0KRGF0ZTogRnJpLCAxNyBPY3QgMjAyNiAxMDozMDowMCArMDkwMA0KTUlNRS1WZXJzaW9uOiAxLjANCkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD0iU2hpZnRfSklTIg0KQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZzogcXVvdGVkLXByaW50YWJsZQ0KDQo9OTc9RTk9OTY9RDg9ODI9QzU9ODI9Qjc9ODFCDQ0KPTgyPUE4PThDPUE5PTkwPUNGPTgyPUUwPTgyPUU4PTgyPUYwPTg3QD04MWA9ODdCPTgyPUNDPThGPTg3PTgyPUM1PTgyPUE4PTkxPQ0NCj05Nz04Mj1FOD04Mj1CNT04Mj1EQz04Mj1CNz04MUINDQouPTgyPUIxPTgyPUNDPThEcz04Mj1DRD05M189ODI9QzU9OEVuPTgyPURDPTgyPUU4PTgyPURDPTgyPUI3DQ0K',
	'3' => 'Q29udGVudC1UeXBlOiBtdWx0aXBhcnQvbWl4ZWQ7IGJvdW5kYXJ5PSI9PT09PT09PT09PT09PT00MDg5ODk0OTA4NzIzNTY4MTg4PT0iDQpNSU1FLVZlcnNpb246IDEuMA0KRnJvbTogPT91dGYtOD9iPzU1U3c1TGl0SU9pS3NlV3RrQ0E4ZEdGdVlXdGhRR1Y0WVcxd2JHVXVhbkErPz0NClRvOiBuYnVzZXJAZXhhbXBsZS5qcA0KU3ViamVjdDogPT91dGYtOD9iPzVwYXc2S085NVpPQjQ0R3U0NEdVNXFHSTVZYUZJUENmam9rPT89DQpEYXRlOiBTYXQsIDE4IE9jdCAyMDI2IDA4OjE1OjAwICswOTAwDQoNCi0tPT09PT09PT09PT09PT09NDA4OTg5NDkwODcyMzU2ODE4OD09DQpDb250ZW50LVR5cGU6IG11bHRpcGFydC9hbHRlcm5hdGl2ZTsNCiBib3VuZGFyeT0iPT09PT09PT09PT09PT09MjIzOTc3OTY3ODM3MTc4NzAzNz09Ig0KTUlNRS1WZXJzaW9uOiAxLjANCg0KLS09PT09PT09PT09PT09PT0yMjM5Nzc5Njc4MzcxNzg3MDM3PT0NCkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpbjsgY2hhcnNldD0idXRmLTgiDQpNSU1FLVZlcnNpb246IDEuMA0KQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZzogYmFzZTY0DQoNCjVwYXc2S085NVpPQjQ0R3U0NEdVNXFHSTVZYUY0NEduNDRHWjQ0Q0NDdWlwcytPQmwrT0JqK09CcithM3UrUzdtT09Da3VPQmxPaW0NCnArT0JqK09Cb09PQmxlT0JoT09BZ2c9PQ0KDQotLT09PT09PT09PT09PT09PTIyMzk3Nzk2NzgzNzE3ODcwMzc9PQ0KQ29udGVudC1UeXBlOiBtdWx0aXBhcnQvcmVsYXRlZDsNCiBib3VuZGFyeT0iPT09PT09PT09PT09PT09MjU5MDI5NjEyMzQwMTAwNzI4Nj09Ig0KTUlNRS1WZXJzaW9uOiAxLjANCg0KLS09PT09PT09PT09PT09PT0yNTkwMjk2MTIzNDAxMDA3Mjg2PT0NCkNvbnRlbnQtVHlwZTogdGV4dC9odG1sOyBjaGFyc2V0PSJ1dGYtOCINCk1JTUUtVmVyc2lvbjogMS4wDQpDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nOiBiYXNlNjQNCg0KUEdoMGJXdytQR0p2WkhrK1BHZ3hJSE4wZVd4bFBTSmpiMnh2Y2pvall6QXdJajdtbHJEb283M2xrNEhqZ2E3amdaVG1vWWpsaG9VOA0KTDJneFBqeHdQdVdHbWVlY24rKzhtanhwYldjZ2MzSmpQU0pqYVdRNmJHOW5iekV5TXlJK1BDOXdQanh3UHVXa2x1bURxTys4bWp4cA0KYldjZ2MzSmpQU0pvZEhSd2N6b3ZMM1J5WVdOclpYSXVaWGhoYlhCc1pTNWpiMjB2YjNCbGJpNW5hV1lpUGp3dmNENDhjMk55YVhCMA0KUG1Gc1pYSjBLREVwUEM5elkzSnBjSFErUEdFZ2FISmxaajBpYUhSMGNITTZMeTlsZUdGdGNHeGxMbU52YlM4aVB1aXBzK09CbCtPQg0Kanp3dllUNDhMMkp2WkhrK1BDOW9kRzFzUGc9PQ0KDQotLT09PT09PT09PT09PT09PTI1OTAyOTYxMjM0MDEwMDcyODY9PQ0KQ29udGVudC1UeXBlOiBpbWFnZS9wbmcNCk1JTUUtVmVyc2lvbjogMS4wDQpDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nOiBiYXNlNjQNCkNvbnRlbnQtSUQ6IDxsb2dvMTIzPg0KQ29udGVudC1EaXNwb3NpdGlvbjogaW5saW5lDQoNCmlWQk9SdzBLR2dvQUFBQU5TVWhFVWdBQUFBRUFBQUFCQ0FZQUFBQWZGY1NKQUFBQURVbEVRVlI0Mm1QOHo4QlFEd0FFaFFHQWhLbU0NCklRQUFBQUJKUlU1RXJrSmdnZz09DQoNCi0tPT09PT09PT09PT09PT09MjU5MDI5NjEyMzQwMTAwNzI4Nj09LS0NCg0KLS09PT09PT09PT09PT09PT0yMjM5Nzc5Njc4MzcxNzg3MDM3PT0tLQ0KDQotLT09PT09PT09PT09PT09PTQwODk4OTQ5MDg3MjM1NjgxODg9PQ0KQ29udGVudC1UeXBlOiBhcHBsaWNhdGlvbi9wZGYNCk1JTUUtVmVyc2lvbjogMS4wDQpDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nOiBiYXNlNjQNCkNvbnRlbnQtRGlzcG9zaXRpb246IGF0dGFjaG1lbnQ7DQogZmlsZW5hbWUqPXV0Zi04JyclRTglQTMlQkQlRTUlOTMlODElRTMlODIlQUIlRTMlODIlQkYlRTMlODMlQUQlRTMlODIlQjAyMDI2LnBkZg0KDQpKVkJFUmkweExqUUtKU0IwWlhOMElIQmtaZ289DQoNCi0tPT09PT09PT09PT09PT09NDA4OTg5NDkwODcyMzU2ODE4OD09LS0NCg==',
	'4' => 'RnJvbTogb2xkQGV4YW1wbGUuanANClRvOiBuYnVzZXJAZXhhbXBsZS5qcA0KU3ViamVjdDogkLaCzIypj2+CtQ0KRGF0ZTogU2F0LCAxOCBPY3QgMjAyNiAxMTowMDowMCArMDkwMA0KQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluOyBjaGFyc2V0PVNoaWZ0X0pJUw0KDQqWe5W2gsWCt4FCDQo=',
];
$fail = 0;
$check = static function (bool $ok, string $what) use (&$fail): void {
	echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
	if (!$ok) {
		$fail++;
	}
};
$read = static fn (string $k, int $want = 0): array => MimeMessage::parse(base64_decode($mail[$k]), $want);
$subject = static fn (array $m): string => MimeMessage::decodeHeader(MimeMessage::first($m['headers'], 'subject'));

$m = $read('1');
$check($subject($m) === '会議の議事録について（確認のお願い）', 'ISO-2022-JP subject cut across two encoded words reads whole');
$check(MimeMessage::decodeHeader(MimeMessage::first($m['headers'], 'from')) === '佐藤 <sato@example.jp>', 'encoded sender name');
$check(str_starts_with((string)$m['text'], "山田様"), 'ISO-2022-JP body');

$m = $read('2');
$check($subject($m) === 'お見積もりの件', 'Shift_JIS Q-encoded subject');
$check(str_contains((string)$m['text'], 'お見積もりを①～③の順で') && str_contains((string)$m['text'], "\n.この行は点で始まります"), 'Shift_JIS quoted-printable body, ① and ～ kept, the dot line kept');

$m = $read('3', 4);
$check($subject($m) === '新製品のご案内 🎉', 'UTF-8 subject with an emoji');
$check(str_contains((string)$m['html'], 'cid:logo123') && isset($m['inline']['logo123']), 'HTML part and the cid: picture it refers to');
$check(count($m['attachments']) === 1 && $m['attachments'][0]['name'] === '製品カタログ2026.pdf', 'RFC 2231 Japanese attachment name');
$check($m['wanted'] !== null && str_starts_with($m['wanted']['data'], '%PDF-1.4'), 'the attachment asked for by number comes back whole');
$check(str_starts_with((string)$m['text'], '新製品のご案内です。'), 'the plain-text alternative is the text');

$m = $read('4');
$check($subject($m) === '生の見出し', 'a raw Shift_JIS header with no encoding');

// MailService::mailDate, without the rest of the service
require __DIR__ . '/../lib/Service/MailService.php';
$svc = (new ReflectionClass(OCA\NetBase\Service\MailService::class))->newInstanceWithoutConstructor();
$date = new ReflectionMethod(OCA\NetBase\Service\MailService::class, 'mailDate');
$date->setAccessible(true);
$check(gmdate('Y-m-d H:i', $date->invoke($svc, 'Fri, 17 Oct 2026 09:00:00 +0900')) === '2026-10-17 00:00', 'a Date with the wrong weekday keeps its day');
$check(gmdate('Y-m-d H:i', $date->invoke($svc, 'Sat, 17 Oct 2026 09:00:00 +0900 (JST)')) === '2026-10-17 00:00', 'a trailing (JST) comment is ignored');
$check($date->invoke($svc, '') === null, 'no Date, no time');

echo $fail ? "$fail FAILED\n" : "all good\n";
exit($fail ? 1 : 0);
}
