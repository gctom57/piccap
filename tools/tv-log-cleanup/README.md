# TV log cleanup

A Homebrew Channel boot hook that stops rotated system logs from filling the TV's RAM. It isn't part of PicCap. It just lives in this repository.

## The problem

On webOS, `/var/log` is in RAM (`ramfs`, which has no size limit). `PmLogDaemon` rotates `/var/log/messages` into files named `messages.XXXXXX`. On some TVs nothing deletes them afterwards, so they pile up at about 2 MB per rotation. On a webOS 3.5 OLED55C7V-Z this reached about 100 MB within two hours of uptime.

We haven't pinned down why nothing cleans them up there. LG's `rdxd` and `remotelogger` were switched off on that TV, but running `rdxd` didn't remove the files either.

## What it does

Every 5 minutes it deletes all but the 2 newest `messages.XXXXXX` files in `/var/log`. Only files with a non-numeric suffix are touched. `/var/log/messages` itself and the numbered archives (`messages.0.gz` …) are left alone. It makes no network connections.

Its own log is written to `/tmp/log-cleanup.log` and kept under 32 KB.

## Install

The TV must be rooted with Homebrew Channel. Copy the script to the TV and run it once (it starts in the background straight away):

```sh
scp 90-log-cleanup root@<tv-ip>:/var/lib/webosbrew/init.d/90-log-cleanup
ssh root@<tv-ip> 'chmod +x /var/lib/webosbrew/init.d/90-log-cleanup && /var/lib/webosbrew/init.d/90-log-cleanup'
```

Keep the file name without a dot. BusyBox `run-parts` skips names that contain one, so the script would never run at boot.

## Options

These are environment variables, read when the loop starts:

| Variable | Default | Meaning |
|---|---|---|
| `KEEP` | `2` | rotated files to keep |
| `INTERVAL` | `300` | seconds between runs |

`90-log-cleanup once` runs a single pass in the foreground.

## Uninstall

```sh
ssh root@<tv-ip> 'kill $(cat /tmp/log-cleanup.pid); rm /var/lib/webosbrew/init.d/90-log-cleanup'
```
