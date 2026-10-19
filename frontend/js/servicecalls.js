import logIt from './log';

const availableQuirks = {
  // DILE_VT
  QUIRK_DILE_VT_CREATE_EX: 0x1,
  QUIRK_DILE_VT_NO_FREEZE_CAPTURE: 0x2,
  QUIRK_DILE_VT_DUMP_LOCATION_2: 0x4,
  // vtCapture
  QUIRK_VTCAPTURE_FORCE_CAPTURE: 0x100,
};

const resolutionPresets = {
  '320x180': [320, 180],
  '256x144': [256, 144],
  '192x108': [192, 108],
  '128x72': [128, 72],
};

// Same limits the service enforces (hyperion-webos src/settings.c)
const limits = {
  port: [1, 65535],
  priority: [0, 255],
  fps: [0, 240],
  width: [16, 3840],
  height: [16, 2160],
};
const UNIX_PATH_MAX = 108;

// Rooting: how long one elevation attempt may take before retrying, and how
// often to retry before giving up
const ELEVATION_TIMEOUT_MS = 30000;
const MAX_ELEVATION_ATTEMPTS = 3;

// Drives the state colours of the status page (dots, ambient edge)
function setState(id, state) {
  document.getElementById(id).setAttribute('data-state', state);
}

// libdile_vt_backend.so -> dile_vt
function backendName(file) {
  return String(file || '').replace(/^lib/, '').replace(/_backend\.so$/, '');
}

let isRoot = false;
let elevationStartedAt = 0; // 0 = no elevation attempt running
let elevationAttempts = 0;
let settingsLoaded = false;

function setSettingsButtonsEnabled(enabled) {
  ['btnSettingsSave', 'btnSettingsReset'].forEach((id) => {
    document.getElementById(id).disabled = !enabled;
  });
}

function onHBExec(result) {
  if (result.returnValue === true) {
    logIt(`HBChannel exec returned. stdout: ${result.stdoutString} stderr: ${result.stderrString}`);
  } else {
    logIt(`HBChannel exec failed! Code: ${result.errorCode}`);
  }
}

function killHyperion() {
  document.getElementById('txtInfoState').innerHTML = 'Killing service..';
  logIt('Calling HBChannel exec to stop hyperion-webos');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        // SIGTERM lets the service stop capture and release the drivers. Only
        // force kill as a last resort: a process killed while capturing
        // breaks DILE_VT capture until the TV reboots (webOS 3.5)
        command: 'pid=$(pidof hyperion-webos) || exit 0; kill $pid; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do sleep 1; kill -0 $pid 2>/dev/null || exit 0; done; kill -9 $pid',
      },
      onSuccess: onHBExec,
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
}

function makeServiceRoot() {
  logIt('Rooting..');
  document.getElementById('txtInfoState').innerHTML = 'Rooting app and service..';
  logIt('Calling HBChannel exec to elevate app and service');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.piccap; /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.piccap.service',
      },
      onSuccess(result) {
        onHBExec(result);
        if (result.returnValue !== true) {
          // Allow the root check loop to retry elevation
          elevationStartedAt = 0;
          document.getElementById('txtInfoState').textContent = 'Elevation failed! Retrying..';
          return;
        }

        logIt('Elevation completed - killing service process..');
        document.getElementById('txtInfoState').textContent = 'Killing service..';
        killHyperion();
      },
      onFailure(result) {
        onHBExec(result);
        // Allow the root check loop to retry elevation
        elevationStartedAt = 0;
        document.getElementById('txtInfoState').textContent = 'Elevation failed! Retrying..';
      },
    },
  );
  /* eslint-enable no-undef */
}

let checkRootStatusIntervalID = null;

// Starts an elevation attempt unless one is still running or we gave up
function maybeElevate() {
  if (isRoot) {
    return;
  }

  if (elevationStartedAt !== 0 && Date.now() - elevationStartedAt < ELEVATION_TIMEOUT_MS) {
    document.getElementById('txtInfoState').innerHTML = 'Not running as root. Service elevation in progress..';
    return;
  }

  // No attempt running, or the last one never took effect
  if (elevationAttempts >= MAX_ELEVATION_ATTEMPTS) {
    logIt(`Service is still not elevated after ${elevationAttempts} attempts, giving up.`);
    document.getElementById('txtInfoState').textContent = 'Elevation failed! Is Homebrew Channel rooted? Restart PicCap to retry.';
    document.getElementById('txtServiceStatus').textContent = 'Not running as root';
    setState('serviceHero', 'error');
    clearInterval(checkRootStatusIntervalID);
    return;
  }

  elevationAttempts += 1;
  elevationStartedAt = Date.now();
  logIt(`Starting elevation attempt ${elevationAttempts}/${MAX_ELEVATION_ATTEMPTS}.`);
  document.getElementById('txtInfoState').innerHTML = 'Not running as root. Service elevation in progress..';
  makeServiceRoot();
}

function onCheckRootStatus(result) {
  if (isRoot) {
    return;
  }

  if (result.returnValue !== true) {
    logIt(`Getting root-status from PicCap-Service failed! Code: ${result.errorCode}`);
    document.getElementById('txtInfoState').innerHTML = 'PicCap-Service status failed!';
    return;
  }

  if (result.elevated) {
    logIt('PicCap-Service returned rooted!');
    document.getElementById('txtInfoState').innerHTML = 'Running as root';
    isRoot = true;
    clearInterval(checkRootStatusIntervalID);
    elevationStartedAt = 0;
    return;
  }

  logIt('PicCap-Service returned not rooted yet!');
  maybeElevate();
}

function checkRoot() {
  document.getElementById('txtServiceStatus').innerHTML = 'Processing root check';
  logIt('Starting loop for PicCap-Service to get root-status');

  let rounds = 0;
  checkRootStatusIntervalID = window.setInterval(() => {
    logIt('Calling PicCap-Service to get root-status');
    document.getElementById('txtInfoState').innerHTML = 'Checking root status';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'status',
        parameters: {},
        onSuccess: onCheckRootStatus,
        onFailure: onCheckRootStatus,
      },
    );
    /* eslint-enable no-undef */

    // An unelevated service can crash before it registers (some capture
    // libraries need root), and then this call never gets any reply. So
    // elevation must not depend on an answer: after one round to let the
    // service start, keep elevating until it reports root.
    rounds += 1;
    if (rounds >= 2) {
      maybeElevate();
    }
  }, 3000);
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

// health (newer services): counters and per-stage time per frame, in us
function showHealth(health) {
  const card = document.getElementById('healthCard');
  if (!health || typeof health !== 'object') {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const num = (v) => (typeof v === 'number' ? String(v) : '-');
  document.getElementById('txtHealthUptime').textContent = typeof health.uptime === 'number' ? formatUptime(health.uptime) : '-';
  document.getElementById('txtHealthFrames').textContent = num(health.frames);
  document.getElementById('txtHealthConnects').textContent = num(health.connects);
  document.getElementById('txtHealthSendErrors').textContent = num(health.sendErrors);
  document.getElementById('txtHealthMissed').textContent = num(health.vsyncMissed);
  document.getElementById('txtHealthRestarts').textContent = num(health.videoRestarts);

  const t = health.timing || {};
  const stages = [['wait', t.waitUs], ['capture', t.acquireUs], ['copy', t.copyUs], ['convert', t.convertUs],
    ['blend', t.processUs], ['send', t.sendUs]];
  const parts = stages.filter((st) => typeof st[1] === 'number')
    .map((st) => `${st[0]} ${(st[1] / 1000).toFixed(1)}`);
  document.getElementById('txtHealthTiming').textContent = parts.length && health.frames > 0 ? `${parts.join(' · ')} ms` : '-';
}

// The main action is the one that changes the current state
function setPrimaryAction(running) {
  const start = document.getElementById('btnServiceStart');
  const stop = document.getElementById('btnServiceStop');
  start.className = running ? 'btn' : 'btn btn-primary';
  stop.className = running ? 'btn btn-primary' : 'btn';
}

// Status tiles: what the settings say capture should be doing
function showSettingsSummary(settings) {
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  text('txtInfoFpsTarget', `${settings.fps ? `target ${settings.fps}` : 'no limit'} · VSync ${settings.vsync ? 'on' : 'off'}`);
  text('txtInfoResolution', `${settings.width} × ${settings.height}`);
  text('txtInfoFormat', settings.nv12 ? 'NV12' : 'RGB · NV12 off');
  const mode = (disabled, backend) => {
    if (disabled) return 'disabled in Settings';
    return !backend || backend === 'auto' ? 'chosen automatically' : 'set in Settings';
  };
  text('txtInfoVideoMode', mode(settings.novideo, settings.backend));
  text('txtInfoUIMode', mode(settings.nogui, settings.uibackend));
  if (settings['unix-socket']) {
    text('txtInfoReceiverAddress', settings.address || '-');
    text('txtInfoReceiverDetail', `local socket · priority ${settings.priority}`);
  } else {
    text('txtInfoReceiverAddress', settings.address ? `${settings.address}:${settings.port}` : 'not set');
    text('txtInfoReceiverDetail', `priority ${settings.priority} · TCP`);
  }
}

/* ---------------- Unsaved changes ---------------- */

let savedForm = null;

// Every field of the Settings page, as one comparable string
function settingsFormState() {
  const fields = document.getElementById('settings').querySelectorAll('input, select');
  return Array.prototype.map.call(fields, (f) => `${f.id}=${f.type === 'checkbox' ? f.checked : f.value}`).join('&');
}

function updateDirty() {
  document.getElementById('settingsDirty').hidden = savedForm === null || settingsFormState() === savedForm;
}

function rememberSavedForm() {
  savedForm = settingsFormState();
  updateDirty();
}

function getStatus() {
  document.getElementById('txtInfoState').innerHTML = 'Getting status info..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'status',
      parameters: {},
      onSuccess(result) {
        if (result.returnValue === true) {
          document.getElementById('txtServiceVersion').textContent = result.version;
          document.getElementById('txtServiceStatus').textContent = result.isRunning ? 'Capturing' : 'Not capturing';

          document.getElementById('txtInfoReceiver').textContent = result.connected ? 'Connected' : 'Disconnected';
          // videoError (newer services) says why video capture is missing
          let videoText = 'Not capturing';
          if (result.videoRunning) {
            videoText = backendName(result.videoBackend);
          } else if (result.videoError) {
            videoText = result.videoError;
          }
          document.getElementById('txtInfoVideo').textContent = videoText;
          document.getElementById('txtInfoUI').textContent = result.uiRunning ? backendName(result.uiBackend) : 'Not capturing';
          document.getElementById('txtInfoFPS').textContent = result.isRunning && typeof result.framerate === 'number' ? result.framerate.toFixed(1) : '-';
          showHealth(result.health);

          let heroState = 'stopped';
          if (result.isRunning) {
            heroState = result.connected ? 'running' : 'waiting';
          }
          setState('serviceHero', heroState);
          setPrimaryAction(result.isRunning === true);
          document.getElementById('txtServiceUptime').textContent = result.health && typeof result.health.uptime === 'number'
            ? ` · up ${formatUptime(result.health.uptime)}` : '';
          setState('tileReceiver', result.connected ? 'ok' : 'off');
          let videoState = 'off';
          if (result.videoRunning) {
            videoState = 'ok';
          } else if (result.isRunning && result.videoError) {
            videoState = 'warn';
          }
          setState('tileVideo', videoState);
          setState('tileUI', result.uiRunning ? 'ok' : 'off');

          document.getElementById('txtInfoState').innerHTML = 'Status info refreshed';
        } else {
          logIt('Getting status info from PicCap-Service failed! Return value false!');
          document.getElementById('txtInfoState').innerHTML = 'Getting status info failed!';
        }
      },
      onFailure(result) {
        logIt(`Getting status info from PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Getting status info failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

function getSettings() {
  document.getElementById('txtInfoState').innerHTML = 'Loading settings..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'getSettings',
      parameters: {},
      onSuccess(result) {
        if (result.returnValue === true) {
          document.getElementById('selectSettingsVideoBackend').value = result.novideo === true ? 'disabled' : result.backend || 'auto';
          document.getElementById('selectSettingsGraphicalBackend').value = result.nogui === true ? 'disabled' : result.uibackend || 'auto';

          document.getElementById('checkSettingsLocalSocket').checked = result['unix-socket'];
          socketCheckChanged(document.getElementById('checkSettingsLocalSocket'));

          const address = result.address || '';
          if (address.includes('/')) {
            switch (address) {
              case '/tmp/hyperhdr-domain':
                document.getElementById('selectSettingsSocket').value = 'hyperhdr';
                break;
              default:
                document.getElementById('selectSettingsSocket').value = 'manual';
                document.getElementById('txtInputSettingsSocketPath').value = address;
            }
            document.getElementById('txtInputSettingsAddress').value = '127.0.0.1';
          } else {
            document.getElementById('txtInputSettingsAddress').value = address || '127.0.0.1';
          }
          socketSelectChanged(document.getElementById('selectSettingsSocket'));

          document.getElementById('txtInputSettingsPort').value = result.port;
          document.getElementById('txtInputSettingsPriority').value = result.priority;

          document.getElementById('txtInputSettingsFPS').value = result.fps;

          // Match presets on the exact size: different sizes can share an area
          const resolution = `${result.width}x${result.height}`;
          if (Object.prototype.hasOwnProperty.call(resolutionPresets, resolution)) {
            document.getElementById('selectSettingsResolution').value = resolution;
          } else {
            document.getElementById('selectSettingsResolution').value = 'manual';
          }
          document.getElementById('txtInputSettingsWidth').value = result.width;
          document.getElementById('txtInputSettingsHeight').value = result.height;
          resolutionChanged(document.getElementById('selectSettingsResolution'));

          Object.keys(availableQuirks).forEach((quirk) => {
            logIt(`Processing: ${quirk}`);
            const quirkval = availableQuirks[quirk];
            const enabled = (result.quirks & quirkval) === quirkval;
            if (enabled) {
              logIt(`Quirk ${quirk} enabled!`);
            }
            document.getElementById(`checkSettings${quirk}`).checked = enabled;
          });

          document.getElementById('checkSettingsVSync').checked = result.vsync;
          document.getElementById('checkSettingsAutostart').checked = result.autostart;
          document.getElementById('checkSettingsNoHDR').checked = result.nohdr;
          document.getElementById('checkSettingsNoPowerstate').checked = result.nopowerstate;
          document.getElementById('checkSettingsNV12').checked = result.nv12;

          settingsLoaded = true;
          setSettingsButtonsEnabled(true);
          showSettingsSummary(result);
          rememberSavedForm();
          // eslint-disable-next-line no-use-before-define
          maybeShowWizard(result);
          logIt('Loading settings done!');
          document.getElementById('txtInfoState').innerHTML = 'Settings loaded';
        } else {
          logIt('Getting settings from PicCap-Service failed! Return value false!');
          document.getElementById('txtInfoState').innerHTML = 'Getting settings failed!';
        }
      },
      onFailure(result) {
        logIt(`Getting settings from PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Getting settings failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

window.restartHyperion = () => {
  document.getElementById('txtInfoState').innerHTML = 'Killing hyperion.. Will be started again through status loop';
  killHyperion();
};

function saveSettings(config, onSaved) {
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'setSettings',
      parameters: config,
      onSuccess(result) {
        if (result.returnValue === true) {
          logIt('Saving settings success!');
          document.getElementById('txtInfoState').innerHTML = 'Save settings success!';
          if (onSaved) {
            onSaved();
          }
        } else {
          logIt(`Save settings for PicCap-Service failed! ${result.errorText || 'Settings were rejected.'}`);
          document.getElementById('txtInfoState').innerHTML = 'Save settings failed!';
        }
        // Show what the service actually has now
        getSettings();
      },
      onFailure(result) {
        logIt(`Save settings for PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Save settings failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

function isIPv4(address) {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

// Returns an error message, or null when the service will accept the config
function validateConfig(config) {
  if (config['unix-socket']) {
    if (typeof config.address !== 'string' || config.address[0] !== '/' || config.address.length >= UNIX_PATH_MAX) {
      return `Socket path must be absolute and shorter than ${UNIX_PATH_MAX} characters`;
    }
  } else if (typeof config.address !== 'string' || !isIPv4(config.address)) {
    return 'Address must be an IPv4 address like 192.168.1.10';
  }

  const invalid = Object.keys(limits).find((key) => {
    const [min, max] = limits[key];
    return !Number.isInteger(config[key]) || config[key] < min || config[key] > max;
  });
  if (invalid) {
    return `${invalid} must be a whole number from ${limits[invalid][0]} to ${limits[invalid][1]}`;
  }

  return null;
}

function readInt(id) {
  const value = document.getElementById(id).value.trim();
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

window.serviceResetSettings = () => {
  if (!settingsLoaded) {
    logIt('Settings not loaded yet, not resetting.');
    return;
  }
  document.getElementById('txtInfoState').innerHTML = 'Loading default settings..';
  const config = {
    backend: 'auto',
    uibackend: 'auto',

    novideo: false,
    nogui: false,

    'unix-socket': false,
    address: '',
    port: 19400,
    priority: 150,

    fps: 0,

    width: 320,
    height: 180,
    quirks: 0,

    vsync: true,
    autostart: false,
    nohdr: false,
    nopowerstate: false,
    nv12: false,
  };
  logIt(`Config: ${JSON.stringify(config)}`);

  document.getElementById('txtInfoState').innerHTML = 'Sending default settings..';
  saveSettings(config);
};

window.serviceSaveSettings = (onSaved) => {
  // Saving an unloaded form would overwrite the stored config with blanks
  if (!settingsLoaded) {
    logIt('Settings not loaded yet, not saving.');
    document.getElementById('txtInfoState').textContent = 'Settings not loaded yet!';
    return;
  }
  document.getElementById('txtInfoState').innerHTML = 'Collecting settings..';

  let quirkcalc = 0;
  Object.keys(availableQuirks).forEach((quirk) => {
    logIt(`Processing quirk: ${quirk}`);
    const quirkval = availableQuirks[quirk];
    logIt(`Quirk val: ${quirkval}`);
    if (document.getElementById(`checkSettings${quirk}`).checked === true) {
      quirkcalc |= quirkval;
      logIt(`Quirkcalc: ${quirkcalc}`);
    }
  });

  let width;
  let height;
  const resolution = document.getElementById('selectSettingsResolution').value;
  if (Object.prototype.hasOwnProperty.call(resolutionPresets, resolution)) {
    [width, height] = resolutionPresets[resolution];
  } else {
    width = readInt('txtInputSettingsWidth');
    height = readInt('txtInputSettingsHeight');
  }

  let address;
  if (document.getElementById('checkSettingsLocalSocket').checked === true) {
    switch (document.getElementById('selectSettingsSocket').value) {
      case 'hyperhdr':
        address = '/tmp/hyperhdr-domain';
        break;
      case 'manual':
        address = document.getElementById('txtInputSettingsSocketPath').value;
        break;
      default:
        address = undefined;
        logIt('Address wasnt found!');
        break;
    }
  } else {
    address = document.getElementById('txtInputSettingsAddress').value;
  }

  const config = {
    backend: document.getElementById('selectSettingsVideoBackend').value === 'disabled' ? 'auto' : document.getElementById('selectSettingsVideoBackend').value,
    uibackend: document.getElementById('selectSettingsGraphicalBackend').value === 'disabled' ? 'auto' : document.getElementById('selectSettingsGraphicalBackend').value,

    novideo: document.getElementById('selectSettingsVideoBackend').value === 'disabled',
    nogui: document.getElementById('selectSettingsGraphicalBackend').value === 'disabled',

    'unix-socket': document.getElementById('checkSettingsLocalSocket').checked,
    address,
    port: readInt('txtInputSettingsPort'),
    priority: readInt('txtInputSettingsPriority'),

    fps: readInt('txtInputSettingsFPS'),

    width,
    height,
    quirks: quirkcalc,

    vsync: document.getElementById('checkSettingsVSync').checked,
    autostart: document.getElementById('checkSettingsAutostart').checked,
    nohdr: document.getElementById('checkSettingsNoHDR').checked,
    nopowerstate: document.getElementById('checkSettingsNoPowerstate').checked,
    nv12: document.getElementById('checkSettingsNV12').checked,
  };

  logIt(`Config: ${JSON.stringify(config)}`);

  const error = validateConfig(config);
  if (error) {
    logIt(`Not saving: ${error}`);
    document.getElementById('txtInfoState').textContent = `Invalid settings: ${error}`;
    return;
  }

  document.getElementById('txtInfoState').innerHTML = 'Sending settings..';
  saveSettings(config, typeof onSaved === 'function' ? onSaved : null);
};

window.reloadHyperionLog = () => {
  logIt('Calling HBCHannel to get latest 200 hyperion-webos log lines.');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: 'grep hyperion-webos /var/log/messages | tail -n200',
      },
      onSuccess(result) {
        onHBExec(result);
        const textareaHyperionLog = document.getElementById('textareaHyperionLog');
        textareaHyperionLog.value = `${result.stdoutString}\r\n`;
      },
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
};

const LOG_EXPORT_PATH = '/tmp/piccap-frontend.log';
// App log plus the service's recent lines, for sending in one go
const LOG_BUNDLE_PATH = '/tmp/piccap-logs.txt';
const LOG_BUNDLE_SERVICE_LINES = 500;
// Base64 keeps the log text out of shell syntax; chunks keep each Luna
// message small. Must stay a multiple of 4 so chunks decode on their own.
const LOG_EXPORT_CHUNK = 12000;

// Appends the service log to a copy of the exported app log. Fixed strings
// only: nothing from the logs reaches the shell.
function bundleLogs() {
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: `{ cat ${LOG_EXPORT_PATH}; echo; echo '===== hyperion-webos: last ${LOG_BUNDLE_SERVICE_LINES} lines of /var/log/messages ====='; grep hyperion-webos /var/log/messages | tail -n ${LOG_BUNDLE_SERVICE_LINES}; } > ${LOG_BUNDLE_PATH}`,
      },
      onSuccess(result) {
        if (result.returnValue !== true) {
          onHBExec(result);
          document.getElementById('txtInfoState').textContent = `PicCap log saved to ${LOG_EXPORT_PATH} (service log not added)`;
          return;
        }
        logIt(`Logs exported to ${LOG_BUNDLE_PATH}`);
        document.getElementById('txtInfoState').textContent = `Logs saved to ${LOG_BUNDLE_PATH}`;
      },
      onFailure(result) {
        onHBExec(result);
        document.getElementById('txtInfoState').textContent = `PicCap log saved to ${LOG_EXPORT_PATH} (service log not added)`;
      },
    },
  );
  /* eslint-enable no-undef */
}

// Writes the in-app PicCap log to a file on the TV, then bundles it with the
// service log, so both can be read over SSH with one cat
window.exportPicCapLog = () => {
  const text = document.getElementById('textareaConsoleLog').value;
  const encoded = window.btoa(unescape(encodeURIComponent(text)));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += LOG_EXPORT_CHUNK) {
    chunks.push(encoded.substr(i, LOG_EXPORT_CHUNK));
  }

  document.getElementById('txtInfoState').textContent = 'Exporting PicCap log..';
  const writeChunk = (index) => {
    if (index >= chunks.length) {
      logIt(`PicCap log exported to ${LOG_EXPORT_PATH}`);
      bundleLogs();
      return;
    }
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.hbchannel.service',
      {
        method: 'exec',
        parameters: {
          command: `echo ${chunks[index]} | base64 -d ${index === 0 ? '>' : '>>'} ${LOG_EXPORT_PATH}`,
        },
        onSuccess(result) {
          if (result.returnValue !== true) {
            onHBExec(result);
            document.getElementById('txtInfoState').textContent = 'Exporting PicCap log failed!';
            return;
          }
          writeChunk(index + 1);
        },
        onFailure(result) {
          onHBExec(result);
          document.getElementById('txtInfoState').textContent = 'Exporting PicCap log failed!';
        },
      },
    );
    /* eslint-enable no-undef */
  };
  writeChunk(0);
};

// Using this function to setup logging for now.
// Future start/stop of currently not implemented hyperion-webos log method.
window.startStopLogging = () => {
  logIt('Setup logging using HBChannel');
  document.getElementById('txtInfoState').innerHTML = 'Calling HBChannel for log setup';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: '/media/developer/apps/usr/palm/services/org.webosbrew.piccap.service/setuplegacylogging.sh',
      },
      onSuccess: onHBExec,
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
/*
  // Future Stuff
  const btnLogStartStop = document.getElementById('btnLogStartStop');
  if (!loggingStarted) {
    loggingStarted = true;
    btnLogStartStop.innerHTML = 'Stop logging';
  } else {
    loggingStarted = false;
    btnLogStartStop.innerHTML = 'Start logging';
  } */
};

function onServiceCallback(result) {
  if (result.returnValue === true) {
    logIt('Servicecall returned successfully.');
    document.getElementById('txtInfoState').innerHTML = 'Servicecall success!';
  } else {
    logIt(`Servicecall failed! Code: ${result.errorCode}`);
    document.getElementById('txtInfoState').innerHTML = 'Servicecall failed!';
  }
}

window.serviceStart = () => {
  logIt('Start clicked');
  try {
    document.getElementById('txtServiceStatus').innerHTML = 'Starting service...';
    document.getElementById('txtInfoState').innerHTML = 'Sending start command';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'start',
        parameters: {},
        onSuccess: onServiceCallback,
        onFailure: onServiceCallback,
      },
    );
    /* eslint-enable no-undef */
  } catch (err) {
    document.getElementById('txtServiceStatus').innerHTML = `Failed: ${JSON.stringify(err)}`;
  }
};

window.serviceStop = () => {
  logIt('Stop clicked');
  try {
    document.getElementById('txtServiceStatus').innerHTML = 'Stopping service...';
    document.getElementById('txtInfoState').innerHTML = 'Sending stop command';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'stop',
        parameters: {},
        onSuccess: onServiceCallback,
        onFailure: onServiceCallback,
      },
    );
    /* eslint-enable no-undef */
  } catch (err) {
    document.getElementById('txtServiceStatus').innerHTML = `Failed: ${JSON.stringify(err)}`;
  }
};

window.serviceReload = () => {
  logIt('Reload clicked');
  getSettings();
};

window.tvReboot = () => {
  logIt('Trying to reboot TV using HBChannel..');
  document.getElementById('txtInfoState').innerHTML = 'Rebooting TV..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'reboot',
      parameters: {},
      onSuccess: onServiceCallback,
      onFailure: onServiceCallback,
    },
  );
  /* eslint-enable no-undef */
};

/* ---------------- Receiver setup: connection test, wizard ---------------- */

function setText(id, text, className) {
  const elem = document.getElementById(id);
  if (elem) {
    elem.textContent = text;
    elem.className = className;
  }
}

function serviceCall(method, parameters, onDone) {
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method,
      parameters,
      onSuccess: onDone,
      onFailure: onDone,
    },
  );
  /* eslint-enable no-undef */
}

window.testReceiver = (addrId, portId, outId) => {
  const address = document.getElementById(addrId).value.trim();
  const port = parseInt(document.getElementById(portId).value, 10);
  if (!isIPv4(address) || !(port >= 1 && port <= 65535)) {
    setText(outId, 'Enter an IPv4 address and a port first', 'test-result fail');
    return;
  }
  setText(outId, `Testing ${address}:${port}...`, 'test-result');
  serviceCall('testReceiver', { address, port }, (result) => {
    if (result && result.returnValue === true && result.reachable) {
      setText(outId, `Reachable${result.flavor ? ` (${result.flavor})` : ''}`, 'test-result ok');
    } else {
      setText(outId, `Not reachable: ${(result && result.errorText) || 'no answer from the service'}`, 'test-result fail');
    }
  });
};

let wizardShown = false;

function maybeShowWizard(settings) {
  let skipped = false;
  try {
    skipped = localStorage.getItem('setupWizardSkipped') === '1';
  } catch (e) {
    skipped = false;
  }
  if (wizardShown || skipped || settings['unix-socket'] || settings.address) {
    return;
  }
  wizardShown = true;
  document.getElementById('setupWizard').classList.add('is-open');
  document.getElementById('btnWizardTest').focus();
}

window.hideWizard = (skipped) => {
  document.getElementById('setupWizard').classList.remove('is-open');
  if (skipped) {
    try {
      localStorage.setItem('setupWizardSkipped', '1');
    } catch (e) {
      // Not remembering the choice only means the wizard comes back
    }
  }
};

// Copies the wizard's receiver into the settings form, saves, then starts
window.wizardFinish = () => {
  const address = document.getElementById('wizardAddress').value.trim();
  const port = document.getElementById('wizardPort').value.trim();
  if (!isIPv4(address)) {
    setText('wizardTestResult', 'Enter the IPv4 address of your receiver', 'test-result fail');
    return;
  }
  document.getElementById('checkSettingsLocalSocket').checked = false;
  window.socketCheckChanged(document.getElementById('checkSettingsLocalSocket'));
  document.getElementById('txtInputSettingsAddress').value = address;
  document.getElementById('txtInputSettingsPort').value = port || '19400';
  window.serviceSaveSettings(() => {
    window.hideWizard(false);
    window.switchView('service');
    window.serviceStart();
  });
};

/* ---------------- Live preview ---------------- */

function drawPreview(result) {
  const box = document.getElementById('previewBox');
  if (!result || result.returnValue !== true || !result.available || !result.rgb) {
    box.classList.add('is-empty');
    return;
  }
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) {
    return;
  }
  const raw = window.atob(result.rgb);
  const image = ctx.createImageData(result.width, result.height);
  const pixels = result.width * result.height;
  for (let i = 0; i < pixels; i += 1) {
    image.data[i * 4] = raw.charCodeAt(i * 3);
    image.data[i * 4 + 1] = raw.charCodeAt(i * 3 + 1);
    image.data[i * 4 + 2] = raw.charCodeAt(i * 3 + 2);
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  box.classList.remove('is-empty');
}

function pollPreview() {
  // Only while the Status page is on screen
  if (!isRoot || document.hidden || document.getElementById('service').style.display === 'none') {
    return;
  }
  serviceCall('getPreview', {}, drawPreview);
}

window.addEventListener('load', () => {
  logIt('Startup of PicCap...');
  setSettingsButtonsEnabled(false);
  const settingsPage = document.getElementById('settings');
  settingsPage.addEventListener('input', updateDirty);
  settingsPage.addEventListener('change', updateDirty);
  checkRoot();

  logIt('Starting load settings loop...');
  const getStatusIntervalID = window.setInterval(() => {
    if (isRoot === true) {
      logIt('Loading settings, we are rooted.');
      getSettings();
      clearInterval(getStatusIntervalID);
    }
  }, 3000);

  setInterval(pollPreview, 1000);

  logIt('Starting status loop...');
  setInterval(() => {
    // No point polling the service while the app is in the background
    if (!document.hidden) {
      getStatus();
    }
  }, 4000);
});
