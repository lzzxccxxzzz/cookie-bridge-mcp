# Security policy

Use **3.2.0 or later**. Earlier revisions have unauthenticated HTTP control, a
path-traversal issue in the image route, and unsafe dashboard HTML interpolation.
Do not run those revisions, even though they remain available in Git history.

## Supported boundary

Cookie Bridge is a trusted-user, loopback-only game controller, not a network
service or a security sandbox. A client with its token can read private game
data and perform destructive gameplay actions. Give the token only to trusted
MCP clients. Confirmation parameters prevent accidental actions; they are not
an authorization boundary against a malicious authenticated client.

- HTTP binds only to `127.0.0.1`. Do not expose it via port forwarding, public
  container mappings, reverse proxies, remote tunnels or shared machines.
- The MCP adapter accepts only loopback HTTP origins, does not follow redirects,
  and reads a 256-bit random token from a local file by default.
- Renderer-only state/dispatch/receipt routes use a separate, process-ephemeral
  credential delivered through validated main-frame IPC, not the client token.
- The dashboard uses an HttpOnly, SameSite=Strict, one-hour session.
  Writes require the exact Origin and JSON content type. Cookies are
  host-scoped, not a boundary between mutually untrusted local services.
- Tokens, saves, gift codes, screenshots, databases, journals and raw test
  outputs are private. Do not commit them or attach them to issues.

The default token is `%USERPROFILE%\CookieBridge\access-token` on Windows.
The directory inherits the user's Windows ACL; POSIX creation requests 0700
for the directory and 0600 for the token. Verify restrictive permissions on
multi-user systems. Authentication does not protect against malware running as
the same OS user, an administrator, or someone able to read the token file.

To revoke access, close the game, remove **only** its `access-token` file and
restart the game. A new token is generated; dashboard sessions and the renderer
credential also expire on restart. Update clients configured with an explicit
`COOKIE_BRIDGE_TOKEN`. File-based MCP clients reread the token.

## Game runtime and limitations

The verified Steam game bundles Electron **11.5.0** and Node **12.18.3**.
These old upstream runtimes are outside this project's dependency-update
control. Our `npm audit` result does **not** cover them, Steam/native libraries,
the game, browser extensions or other mods. Keep game/OS updates current and
do not use the game window as a general-purpose browser.

The game and all installed mods remain trusted code. Disabling renderer Node
integration, checking IPC sender/frame/URL, and preventing remote navigation
and privileged popup windows reduce exposure; they do not make arbitrary
third-party mods safe. Dashboard CSP blocks remote JavaScript, framing and
external connections, but still allows inline scripts for the inherited UI:
escaping dynamic HTML remains essential. Google Fonts styles/fonts are optional
external requests; game saves/tokens are not placed in their URLs.

CDP is enabled only by the isolated test launcher. It grants full control of
the test renderer; keep its port private and stop the test copy when finished.
Normal installation does not open a CDP port. DevTools UI is opt-in with
`COOKIE_BRIDGE_DEVTOOLS=1`.

## Reporting

Do not post credentials, saves or weaponized exploit details in a public issue.
Use GitHub's private vulnerability reporting if enabled; otherwise open an issue
requesting a private reporting channel without sensitive details.

The [3.2.0 security review](docs/security-review-3.2.0.md) records the scope,
fixes, verification and exclusions. It is a point-in-time review, not a guarantee
that no vulnerabilities exist.
