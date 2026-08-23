# Device test rig

A pretend device web interface, for checking that a **device window** really
behaves like the real thing. It is built out of everything that makes actual
router and printer interfaces awkward:

- EUC-JP markup with the character set declared only in a `<meta>` tag, and no
  `charset` in the HTTP header
- root-relative stylesheets, scripts and images
- links aimed at the whole browser (`target="_top"`, `_parent`)
- a login form that redirects and sets a cookie
- a frameset
- a script that writes another script tag, plus XHR and `fetch`
- a page behind HTTP authentication

Run it on the machine that hosts NetBase:

```
php -d default_charset= -S 127.0.0.1:8008 tests/testrig/router.php
```

Then open a window on `127.0.0.1` port `8008` from the device list — 8008 is
one of the ports NetBase treats as a web interface — and walk through the
links. Everything should stay inside the window, and nothing should navigate
the Nextcloud page itself.
