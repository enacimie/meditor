# meditor on Windows

## Smart App Control blocks the installer

On a clean Windows 11 install, downloading `meditor_<version>_x64-setup.exe`
from the Releases page and running it gets you this:

> **Smart App Control blocked an app that might be unsafe**
> We blocked `meditor_…_x64-setup.exe` because we could not verify its
> publisher to confirm it was safe to run.

Nothing is wrong with the download. meditor's installers are **not code
signed**, and Smart App Control refuses to run an unsigned executable that
came from the internet.

Both halves of that sentence matter, and the second one is easy to miss:

| File | Signed | From the internet | Result |
| --- | --- | --- | --- |
| Installer from the Releases page | no | yes (`ZoneId=3`) | **blocked** |
| Installer you built yourself | no | no | runs |
| `meditor.exe` you built yourself | no | no | runs |

Windows tags every downloaded file with a "mark of the web" — an alternate
data stream naming the zone it came from. Smart App Control combines that with
the missing signature and refuses. The same unsigned binary compiled on your
own machine carries no such mark and starts without complaint, which is why
this never shows up during development.

### Do not turn Smart App Control off

It is tempting and it is close to irreversible: on Windows 11, switching Smart
App Control off cannot be undone without reinstalling the operating system.
Unlike SmartScreen it also offers no per-file "run anyway", so there is no
exception to grant either.

### What you can do instead

- **Build the installer yourself.** It comes out unmarked and installs
  normally:

  ```bash
  pnpm tauri build --bundles nsis
  # src-tauri/target/release/bundle/nsis/meditor_<version>_x64-setup.exe
  ```

- **Run it without installing.** `src-tauri/target/release/meditor.exe` after
  a build, or the portable binary from a machine that can produce one.

- **Install on a machine without Smart App Control.** It is off by default on
  systems upgraded from Windows 10, and on managed devices where policy
  disables it.

## Why the installers are not signed

Authenticode signing needs a certificate from a certificate authority, and
meditor is an AGPL project that does not pay for proprietary developer
licences — the same position [docs/ios.md](ios.md) takes on Apple's developer
program.

Three routes exist if that changes:

| Route | Cost | Catch |
| --- | --- | --- |
| [SignPath.io](https://signpath.io) | free for open source | application and review; the closest fit for this project |
| Azure Trusted Signing | ~10 USD/month | requires a verified legal entity |
| Traditional OV/EV certificate | 200–500 EUR/year | EV builds reputation fastest |

One honest caveat before anyone buys anything: signing is necessary but may
not be sufficient on day one. Smart App Control weighs reputation as well as
signature, and reputation accrues over time or comes with an EV certificate.
Expect a signed build to still be treated with suspicion for a while.

## Where meditor installs

The NSIS installer is per-user by default, which puts the app in
`C:\Users\<you>\AppData\Local\meditor\meditor.exe` and its uninstall entry
under `HKCU`. That is normal and it is not the cause of anything: file
associations follow the same scope, landing in `HKCU\Software\Classes`, which
Windows honours exactly like the machine-wide hive.
